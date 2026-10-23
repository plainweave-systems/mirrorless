;; Copyright 2026 Plainweave Systems
;; SPDX-License-Identifier: Apache-2.0
(ns task-example
  (:require ["../shared/task-api.js" :as api]
            ["mirrorless" :as mirrorless]))

;; Plain-data consumers, not a ClojureScript renderer or an entity database.
;; The JS library delivers frozen JS arrays/objects; use ordinary interop.
(defn print-tasks [tasks]
  (println "Tasks:" (js/JSON.stringify tasks)))
(defn print-summary [summary]
  (println "Summary:" (js/JSON.stringify summary)))
(defn print-task [task]
  (println "Selected task:" (js/JSON.stringify task)))

(defn flags [args]
  (loop [args (seq args) options {:live false :complete-created false}]
    (if-not args
      (do
        (when (and (:complete-created options) (not (:title options)))
          (throw (js/Error. "--complete-created requires --add")))
        options)
      (case (first args)
        "--add" (let [title (second args)]
                  (when (or (nil? title) (.startsWith title "--"))
                    (throw (js/Error. "--add requires a title")))
                  (recur (nnext args) (assoc options :title title)))
        "--select" (let [id (second args)]
                     (when (or (nil? id) (.startsWith id "--"))
                       (throw (js/Error. "--select requires an id")))
                     (recur (nnext args) (assoc options :selected-id id)))
        "--live" (recur (next args) (assoc options :live true))
        "--complete-created" (recur (next args) (assoc options :complete-created true))
        (throw (js/Error. (str "Unknown flag: " (first args))))))))

(defn watch! [runtime cleanups name consume params]
  (let [subscription (.subscribe runtime name params #js {:fetch false})
        render (fn []
                 (let [snapshot (.getSnapshot subscription)
                       data (.-data snapshot)]
                   (when (.-loading snapshot) (println (str name ": loading")))
                   (when (= "error" (.-status snapshot))
                     (js/console.error (str name ":") (.-error snapshot)))
                   ;; nil? would wrongly exclude null: only undefined is absent.
                   (when-not (undefined? data) (consume data))))]
    (swap! cleanups conj #(.unsubscribe subscription))
    (.onChange subscription render)
    (render)
    subscription))

(defn add! [runtime cleanups interaction options]
  (swap! interaction assoc :pending true :command-error nil)
  (println "Command pending:" (:pending @interaction))
  (-> (.command runtime "CreateTask" #js {:title (:title options)})
      (.then (fn [receipt]
               ;; Only {id} comes back. Never conj into tasks or edit a summary atom.
               (println "CreateTask receipt:" (js/JSON.stringify receipt))
               (when (:complete-created options)
                 (let [id (.-id receipt)
                       params #js {:id id}
                       detail (watch! runtime cleanups "GetTask" print-task params)]
                   ;; Native ESM root import and ordinary JS function interop.
                   (assert (mirrorless/sameParams params #js {:id id}))
                   (-> (.refetch detail)
                       (.then (fn [_]
                                ;; Shared helper binds Symbol.for('id') to this command's id.
                                ;; New JS params object, equal by value, not identity.
                                (.command runtime "UpdateTask" #js {:id id :done true})))
                       (.then (fn [updated]
                                (println "UpdateTask receipt:" (js/JSON.stringify updated)))))))))
      (.catch (fn [error]
                (swap! interaction assoc :command-error error)
                (throw error)))
      (.finally (fn []
                  (swap! interaction assoc :pending false)
                  (println "Command pending:" (:pending @interaction))))))

(defn live! [runtime cleanups]
  (swap! cleanups conj
         (api/startLiveRefresh runtime 2000
                               #js {:onError #(js/console.error "RefreshTasks:" %)}))
  (println "Live: RefreshTasks every 2000ms; Ctrl-C to stop")
  (js/Promise.
   (fn [resolve _reject]
     ;; Shared timer is unref'ed; keep this CLI alive until an explicit signal.
     (let [keep-alive (js/setInterval (fn []) 60000)
           stop (fn [] (resolve nil))]
       (.once js/process "SIGINT" stop)
       (.once js/process "SIGTERM" stop)
       (swap! cleanups conj
              (fn []
                (js/clearInterval keep-alive)
                (.off js/process "SIGINT" stop)
                (.off js/process "SIGTERM" stop)))))))

(defn main! [args]
  (let [options (flags args)
        base-url (or (.. js/process -env -TASK_API_URL) "http://127.0.0.1:4000/api")
        url (js/URL. base-url)]
    (when-not (and (= "http:" (.-protocol url))
                   (contains? #{"localhost" "127.0.0.1" "[::1]"} (.-hostname url))
                   (= "" (.-username url) (.-password url)))
      (throw (js/Error. "TASK_API_URL must be a credential-free loopback HTTP URL")))
    (let [runtime (api/createTaskRuntime #js {:baseUrl base-url :unsubscribeDelayMs 0})
          ;; Only CLI interaction state and lifecycle callbacks live in atoms.
          interaction (atom {:pending false :command-error nil})
          cleanups (atom [])]
      (-> (js/Promise.resolve)
          (.then (fn []
                   (let [tasks (watch! runtime cleanups "GetTasks" print-tasks #js {})
                         summary (watch! runtime cleanups "GetSummary" print-summary #js {})]
                     ;; Summary has its own subscription, not a derived task count.
                     (js/Promise.all #js [(.refetch tasks) (.refetch summary)]))))
          (.then (fn [_]
                   (when-let [id (:selected-id options)]
                     (.refetch (watch! runtime cleanups "GetTask" print-task #js {:id id})))))
          (.then (fn [_]
                   (when (:title options) (add! runtime cleanups interaction options))))
          (.then (fn [_]
                   (when (:live options) (live! runtime cleanups))))
          (.finally (fn []
                      (doseq [cleanup (reverse @cleanups)] (cleanup))
                      (.dispose runtime)))))))

(-> (js/Promise.resolve)
    (.then (fn [] (main! *command-line-args*)))
    (.catch (fn [error]
              (js/console.error "Example failed:" error)
              (set! (.-exitCode js/process) 1))))
