import {
  InMemoryTelemetryContext,
  type RecordedTelemetrySpan,
} from '@earendil-works/pi-telemetry';

export const runtimeTelemetry = new InMemoryTelemetryContext();

export function listRuntimeSpans(ownerId: string): readonly RecordedTelemetrySpan[] {
  return runtimeTelemetry
    .getSpans()
    .filter((span) => span.attributes.ownerId === ownerId);
}
