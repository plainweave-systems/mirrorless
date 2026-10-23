// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

const maxBodyBytes = 16_384

type task struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Done  bool   `json:"done"`
}

type taskAPI struct {
	mu     sync.Mutex
	tasks  map[string]task
	nextID int
}

type httpError struct {
	status  int
	message string
}

func (e *httpError) Error() string { return e.message }

func newTaskAPI() *taskAPI {
	return &taskAPI{
		tasks: map[string]task{
			"1": {ID: "1", Title: "Keep client state local", Done: false},
			"2": {ID: "2", Title: "Let server data flow", Done: true},
		},
		nextID: 3,
	}
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if status >= 400 {
		w.Header().Set("Connection", "close")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func readJSON(w http.ResponseWriter, r *http.Request, create bool) (map[string]any, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return nil, &httpError{415, "Use Content-Type: application/json"}
	}
	if r.ContentLength > maxBodyBytes {
		return nil, &httpError{413, "JSON body exceeds 16384 bytes"}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, &httpError{413, "JSON body exceeds 16384 bytes"}
		}
		return nil, &httpError{400, "Unable to read request body"}
	}
	var value map[string]any
	if json.Unmarshal(body, &value) != nil || value == nil {
		return nil, &httpError{400, "Body must be a JSON object"}
	}
	if len(value) == 0 {
		return nil, &httpError{400, "Provide title and/or done"}
	}
	for key := range value {
		if key != "title" && (create || key != "done") {
			return nil, &httpError{400, "Unknown task field"}
		}
	}
	if rawTitle, exists := value["title"]; exists {
		title, ok := rawTitle.(string)
		title = strings.TrimSpace(title)
		if !ok || title == "" || utf8.RuneCountInString(title) > 200 {
			return nil, &httpError{400, "title must be a string of 1–200 characters"}
		}
		value["title"] = title
	} else if create {
		return nil, &httpError{400, "title is required"}
	}
	if done, exists := value["done"]; exists {
		if _, ok := done.(bool); !ok {
			return nil, &httpError{400, "done must be a boolean"}
		}
	}
	return value, nil
}

var taskPath = regexp.MustCompile(`^/api/tasks/([1-9][0-9]*)$`)

func (api *taskAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	match := taskPath.FindStringSubmatch(path)
	var allowed string
	switch {
	case path == "/api/tasks":
		allowed = "GET, POST"
	case path == "/api/summary":
		allowed = "GET"
	case match != nil:
		allowed = "GET, PATCH, DELETE"
	default:
		reply(w, 404, map[string]string{"error": "Not found"})
		return
	}
	if !strings.Contains(", "+allowed+", ", ", "+r.Method+", ") {
		w.Header().Set("Allow", allowed)
		reply(w, 405, map[string]string{"error": "Method not allowed"})
		return
	}

	var values map[string]any
	if r.Method == "POST" || r.Method == "PATCH" {
		if match != nil {
			api.mu.Lock()
			_, exists := api.tasks[match[1]]
			api.mu.Unlock()
			if !exists {
				reply(w, 404, map[string]string{"error": "Task not found"})
				return
			}
		}
		var err error
		values, err = readJSON(w, r, r.Method == "POST")
		if err != nil {
			var failure *httpError
			if errors.As(err, &failure) {
				reply(w, failure.status, map[string]string{"error": failure.message})
			} else {
				reply(w, 500, map[string]string{"error": "Internal server error"})
			}
			return
		}
	}

	api.mu.Lock()
	defer api.mu.Unlock()
	switch {
	case path == "/api/summary":
		done := 0
		for _, task := range api.tasks {
			if task.Done {
				done++
			}
		}
		reply(w, 200, map[string]int{"total": len(api.tasks), "done": done})
	case path == "/api/tasks" && r.Method == "GET":
		tasks := make([]task, 0, len(api.tasks))
		for _, task := range api.tasks {
			tasks = append(tasks, task)
		}
		sort.Slice(tasks, func(i, j int) bool {
			a, _ := strconv.Atoi(tasks[i].ID)
			b, _ := strconv.Atoi(tasks[j].ID)
			return a < b
		})
		reply(w, 200, tasks)
	case path == "/api/tasks":
		id := strconv.Itoa(api.nextID)
		api.nextID++
		api.tasks[id] = task{ID: id, Title: values["title"].(string), Done: false}
		reply(w, 201, map[string]string{"id": id})
	default:
		id := match[1]
		task, exists := api.tasks[id]
		if !exists {
			reply(w, 404, map[string]string{"error": "Task not found"})
			return
		}
		switch r.Method {
		case "GET":
			reply(w, 200, task)
		case "PATCH":
			if title, exists := values["title"]; exists {
				task.Title = title.(string)
			}
			if done, exists := values["done"]; exists {
				task.Done = done.(bool)
			}
			api.tasks[id] = task
			reply(w, 200, map[string]bool{"ok": true})
		case "DELETE":
			delete(api.tasks, id)
			reply(w, 200, map[string]bool{"ok": true})
		}
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}
	if !regexp.MustCompile(`^[0-9]+$`).MatchString(port) {
		log.Fatal("PORT must be an integer from 0 to 65535")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number > 65535 {
		log.Fatal("PORT must be an integer from 0 to 65535")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Handler:           newTaskAPI(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       2 * time.Second,
		MaxHeaderBytes:    8192,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	failed := make(chan error, 1)
	go func() { failed <- server.Serve(listener) }()
	fmt.Printf("Mirrorless Go task API: http://%s\n", listener.Addr())
	select {
	case err := <-failed:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
		}
	}
}
