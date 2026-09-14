/**
 * Argv safety guards, re-exported at their new home.
 *
 * The implementation still lives at ../../security/kubectl-flags.ts,
 * alongside the legacy synchronous execFileSyncSafe() that the
 * not-yet-converted src/tools/*.ts files call directly. Once every tool is
 * converted and the old dispatcher is deleted, the guards move here
 * physically and that file goes away. Until then: new code (core/kubectl.ts
 * and everything in core/operations/) imports the guards from HERE, never
 * from the old path, so the physical move later is a one-file change.
 */
export {
  assertNoDangerousFlags,
  assertNoRemoteFileReads,
  assertNotFlagLike,
  assertSafeArgv,
} from "../../security/kubectl-flags.js";
