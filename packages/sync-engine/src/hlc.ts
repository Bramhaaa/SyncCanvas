import type { Hlc, HlcClock, HlcClockOptions, HlcString } from "./types.js";

const NODE_ID_PATTERN = /^[a-z0-9_]{1,32}$/;
const HLC_PATTERN = /^(\d{13}):(\d{5}):([a-z0-9_]{1,32})$/;
const MAX_PHYSICAL_TIME = 9_999_999_999_999; // 13-digit max
const MAX_COUNTER = 99_999;
const DEFAULT_MAX_DRIFT_MS = 60_000;

export class ClockSkewError extends Error {
  readonly code = "CLOCK_SKEW" as const;

  constructor(message: string) {
    super(message);
    this.name = "ClockSkewError";
  }
}

export function parseHlc(raw: HlcString): Hlc {
  const match = HLC_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`Invalid HLC string: "${raw}"`);
  }
  return {
    physicalTime: Number(match[1]),
    counter: Number(match[2]),
    nodeId: match[3]!,
  };
}

export function formatHlc(hlc: Hlc): HlcString {
  if (
    !Number.isInteger(hlc.physicalTime) ||
    hlc.physicalTime < 0 ||
    hlc.physicalTime > MAX_PHYSICAL_TIME
  ) {
    throw new Error(`Invalid HLC physicalTime: ${hlc.physicalTime}`);
  }
  if (!Number.isInteger(hlc.counter) || hlc.counter < 0 || hlc.counter > MAX_COUNTER) {
    throw new Error(`Invalid HLC counter: ${hlc.counter}`);
  }
  if (!NODE_ID_PATTERN.test(hlc.nodeId)) {
    throw new Error(`Invalid HLC nodeId: "${hlc.nodeId}"`);
  }

  const pt = String(hlc.physicalTime).padStart(13, "0");
  const counter = String(hlc.counter).padStart(5, "0");
  return `${pt}:${counter}:${hlc.nodeId}`;
}

/**
 * Total order over serialized HLC strings.
 * Fixed-width zero-padded physicalTime and counter plus colon-free ASCII nodeId
 * make UTF-16 code-point order identical to (physicalTime, counter, nodeId) tuple order.
 */
export function compareHlc(a: HlcString, b: HlcString): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function createHlcClock(options: HlcClockOptions): HlcClock {
  const { nodeId, now, maxDriftMs = DEFAULT_MAX_DRIFT_MS, initial } = options;

  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new Error(`Invalid nodeId: "${nodeId}"`);
  }

  let state: Hlc =
    initial !== undefined
      ? { ...parseHlc(initial), nodeId }
      : { physicalTime: 0, counter: 0, nodeId };

  return {
    tick(): HlcString {
      const currentNow = now();
      let physicalTime: number;
      let counter: number;

      if (currentNow > state.physicalTime) {
        physicalTime = currentNow;
        counter = 0;
      } else {
        physicalTime = state.physicalTime;
        counter = state.counter + 1;
      }

      if (counter > MAX_COUNTER) {
        physicalTime += 1;
        counter = 0;
      }

      state = { physicalTime, counter, nodeId };
      return formatHlc(state);
    },

    receive(remoteRaw: HlcString): void {
      const remote = parseHlc(remoteRaw);
      const currentNow = now();

      if (remote.physicalTime > currentNow + maxDriftMs) {
        throw new ClockSkewError(
          `Remote HLC physicalTime ${remote.physicalTime} exceeds now (${currentNow}) + maxDriftMs (${maxDriftMs})`,
        );
      }

      let physicalTime = Math.max(currentNow, state.physicalTime, remote.physicalTime);
      let counter: number;

      if (physicalTime === state.physicalTime && physicalTime === remote.physicalTime) {
        counter = Math.max(state.counter, remote.counter) + 1;
      } else if (physicalTime === state.physicalTime) {
        counter = state.counter + 1;
      } else if (physicalTime === remote.physicalTime) {
        counter = remote.counter + 1;
      } else {
        counter = 0;
      }

      if (counter > MAX_COUNTER) {
        physicalTime += 1;
        counter = 0;
      }

      state = { physicalTime, counter, nodeId };
    },

    last(): HlcString {
      return formatHlc(state);
    },
  };
}
