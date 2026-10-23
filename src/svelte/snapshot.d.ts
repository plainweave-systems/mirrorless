// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import type { Equality, OperationParams, QuerySnapshot } from 'mirrorless'

export declare function idleSnapshot(id: string, params?: OperationParams): QuerySnapshot<never>
export declare function snapshotMatches(snapshot: QuerySnapshot, id: string, params?: OperationParams, equal?: Equality): boolean
export declare function throwInitialError(error: unknown): never
