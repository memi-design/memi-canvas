import {
  TargetFenceActivationRequestSchema,
  type Lease,
} from "../../protocol/src/index.js";

import {
  LeaseStore,
  type AssertLeaseRequest,
} from "./lease-store.js";
import type {
  CanvasTargetAdapter,
  RuntimeFaults,
} from "./types.js";

export class CanvasFenceCoordinator {
  readonly #leases: LeaseStore;
  readonly #target: CanvasTargetAdapter;
  readonly #faults: RuntimeFaults | undefined;

  constructor(
    leases: LeaseStore,
    target: CanvasTargetAdapter,
    faults: RuntimeFaults | undefined,
  ) {
    this.#leases = leases;
    this.#target = target;
    this.#faults = faults;
  }

  async activate(input: AssertLeaseRequest): Promise<Lease> {
    const lease = this.#leases.prepareActivation(input);
    const request = TargetFenceActivationRequestSchema.parse({
      schemaVersion: 1,
      projectId: lease.projectId,
      target: {
        kind: "canvas-document",
        id: lease.targetId,
      },
      leaseId: lease.id,
      holderId: lease.holderId,
      fencingEpoch: lease.fencingEpoch,
    });

    // Target I/O is deliberately outside RuntimeDatabase.transaction().
    const result = await this.#target.activateFence(request);
    this.#leases.recordTargetActivation(input, result);
    this.#faults?.afterTargetFenceRecorded?.();
    return this.#leases.finalizeActivation(input);
  }
}
