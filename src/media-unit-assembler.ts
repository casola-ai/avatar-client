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
      return null;
    }

    if (
      unit.frameType !== frame.frameType ||
      unit.channelId !== frame.channelId ||
      unit.ptsUs !== frame.ptsUs
    ) {
      this.partial.delete(frame.channelId);
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
