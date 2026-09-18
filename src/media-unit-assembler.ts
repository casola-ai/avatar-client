import { FrameFlags, type MediaFrame } from './protocol';

export interface MediaUnit {
  frameType: number;
  channelId: number;
  ptsUs: number;
  payload: Uint8Array;
}

interface PartialUnit {
  frameType: number;
  channelId: number;
  ptsUs: number;
  chunks: Uint8Array[];
  bytes: number;
}

/** Reassembles explicit UNIT_START/UNIT_END fragments before a codec sees their payload. */
export class MediaUnitAssembler {
  private readonly partial = new Map<number, PartialUnit>();

  /** `onDrop` is told why a fragment was discarded — a continuation with no start
   *  (`no_start`), or one whose header disagrees with the unit in progress (`mismatch`). These
   *  were dropped silently before (charmingly#288, §D). */
  constructor(private readonly onDrop?: (reason: 'no_start' | 'mismatch') => void) {}

  push(frame: MediaFrame): MediaUnit | null {
    const starts = Boolean(frame.flags & FrameFlags.UNIT_START);
    const ends = Boolean(frame.flags & FrameFlags.UNIT_END);
    let unit = this.partial.get(frame.channelId);

    if (starts) {
      unit = {
        frameType: frame.frameType,
        channelId: frame.channelId,
        ptsUs: frame.ptsUs,
        chunks: [],
        bytes: 0,
      };
      this.partial.set(frame.channelId, unit);
    } else if (!unit) {
      this.onDrop?.('no_start');
      return null;
    }

    if (
      unit.frameType !== frame.frameType ||
      unit.channelId !== frame.channelId ||
      unit.ptsUs !== frame.ptsUs
    ) {
      this.partial.delete(frame.channelId);
      this.onDrop?.('mismatch');
      return null;
    }
    const chunk = frame.payload.slice();
    unit.chunks.push(chunk);
    unit.bytes += chunk.byteLength;
    if (!ends) return null;

    this.partial.delete(frame.channelId);
    const payload = new Uint8Array(unit.bytes);
    let offset = 0;
    for (const part of unit.chunks) {
      payload.set(part, offset);
      offset += part.byteLength;
    }
    return {
      frameType: unit.frameType,
      channelId: unit.channelId,
      ptsUs: unit.ptsUs,
      payload,
    };
  }

  discardFrom(cutoffPtsUs: number): void {
    // No partial unit has reached a codec yet, so it is entirely unheard. A unit that started
    // before the cutoff may still straddle it; without duration in the v2 header there is no safe
    // way to retain just its prefix. Drop every partial on interruption so later UNIT_END frames
    // cannot resurrect a discarded media tail.
    void cutoffPtsUs;
    this.partial.clear();
  }

  clear(): void {
    this.partial.clear();
  }
}
