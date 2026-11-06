/**
 * Output Validity Gate (Prompt: Output Validity Gate & Quality-Driven Rotation).
 *
 * Makes "did the model actually produce something usable?" a FIRST-CLASS signal
 * rather than assuming HTTP 200 == success. An empty/degenerate 200 currently
 * passes as healthy, so rotation never fires and the user gets a hollow bubble.
 *
 * Two surfaces:
 *   1. A pure classifier (unit-testable, no I/O) that turns an observation of a
 *      finished stream into VALID | DEGENERATE(reason).
 *   2. An O(1) incremental tracker used in the hot SSE loop. The STRICT rule that
 *      the gate must not add latency to valid streams is honored here: the very
 *      first non-empty token or tool-call fragment flips the stream to VALID
 *      immediately, and every later byte is a cheap boolean check. The reason
 *      taxonomy is only resolved once, at stream end.
 *
 * VALID:     trimmed content length > 0 OR at least one tool call.
 * DEGENERATE:
 *   - error_in_200         : a data chunk parsed as a JSON object with an `error` key
 *   - zero_data_events     : the stream closed without a single data event
 *   - missing_finish_reason: finish_reason absent AND zero tokens produced
 *   - empty_content        : data events arrived but produced no usable output
 */

export type DegenerateReason =
  | 'error_in_200'
  | 'zero_data_events'
  | 'missing_finish_reason'
  | 'empty_content';

export type StreamValidity =
  | { valid: true }
  | { valid: false; reason: DegenerateReason };

export interface StreamObservation {
  /** Length of the trimmed assistant content at stream end (post any reasoning salvage). */
  contentLen: number;
  /** True when at least one well-formed tool call was captured. */
  hasToolCall: boolean;
  /** Count of SSE data events parsed (excluding `[DONE]` and non-data frames). */
  dataEventCount: number;
  /** Normalized finish_reason at stream end, or null when never seen. */
  finishReason: string | null;
  /** Provider-reported output/completion token count when usage was present (0 if unknown). */
  tokenCount: number;
  /** True when any parsed data chunk carried a top-level `error` key (error-in-200). */
  sawErrorObject: boolean;
}

/** Pure classification of a finished stream. No I/O, fully unit-testable. */
export function classifyStreamOutput(o: StreamObservation): StreamValidity {
  // A tool call with no prose is a perfectly valid agentic turn.
  if (o.hasToolCall) return { valid: true };
  if (o.contentLen > 0) return { valid: true };

  // Nothing usable was produced. Order the reason taxonomy from the most
  // diagnostic (a server smuggled an error inside a 200) to the least.
  if (o.sawErrorObject) return { valid: false, reason: 'error_in_200' };
  if (o.dataEventCount === 0) return { valid: false, reason: 'zero_data_events' };
  if (!o.finishReason && o.tokenCount === 0) return { valid: false, reason: 'missing_finish_reason' };
  return { valid: false, reason: 'empty_content' };
}

/**
 * Hot-path tracker. Call `markContent()` on the first non-empty content token
 * and `markToolCall()` on the first tool-call fragment; both are O(1) and set
 * `immediatelyValid` so the completion check does zero extra work for a healthy
 * stream. Accumulate the reason signals with `noteDataEvent`, `noteErrorFrame`,
 * `noteFinishReason` and `noteTokens` as the stream progresses.
 */
export class StreamValidityTracker {
  private sawToolCall = false;
  private sawContent = false;
  private sawErrorObject = false;
  private dataEvents = 0;
  private finishReason: string | null = null;
  private tokens = 0;

  /** True the instant any real content/tool output arrives — never flips back. */
  public get immediatelyValid(): boolean {
    return this.sawContent || this.sawToolCall;
  }

  public markContent(): void {
    this.sawContent = true;
  }

  public markToolCall(): void {
    this.sawToolCall = true;
  }

  public noteDataEvent(): void {
    this.dataEvents += 1;
  }

  public noteErrorFrame(): void {
    this.sawErrorObject = true;
  }

  public noteFinishReason(reason: string): void {
    this.finishReason = reason;
  }

  public noteTokens(count: number): void {
    if (count > this.tokens) this.tokens = count;
  }

  /** Resolve the final classification at stream end (reads accumulated state). */
  public observe(contentLen: number): StreamValidity {
    return classifyStreamOutput({
      contentLen,
      hasToolCall: this.sawToolCall,
      dataEventCount: this.dataEvents,
      finishReason: this.finishReason,
      tokenCount: this.tokens,
      sawErrorObject: this.sawErrorObject
    });
  }

  public snapshot(): StreamObservation {
    return {
      contentLen: 0,
      hasToolCall: this.sawToolCall,
      dataEventCount: this.dataEvents,
      finishReason: this.finishReason,
      tokenCount: this.tokens,
      sawErrorObject: this.sawErrorObject
    };
  }
}
