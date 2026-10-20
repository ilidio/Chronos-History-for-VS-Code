import { RangeAnchoring, Snapshot } from '../types';

/**
 * Presentation of how a snapshot's `relevantRange` was arrived at.
 *
 * The webviews render their rows in browser JavaScript inside an HTML string,
 * so they cannot call into the extension. The label is therefore computed here,
 * where it can be tested, and attached to the data they are sent.
 */
export function describeRangeAnchoring(snapshot: Snapshot): string | undefined {
    const range = snapshot?.relevantRange;
    if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') return undefined;

    const lines = range.start === range.end
        ? `Line ${range.start + 1}`
        : `Lines ${range.start + 1}-${range.end + 1}`;

    return `${lines} — ${describeAnchoring(snapshot.rangeAnchoring)}`;
}

function describeAnchoring(anchoring?: RangeAnchoring): string {
    switch (anchoring) {
        case 'content':
            return 'block re-found by content';
        case 'origin':
            return 'earliest version of the block we hold';
        default:
            return 'tracked by position';
    }
}

/**
 * Adds `anchoringLabel` to every snapshot in a list, descending into the
 * cluster wrappers the views receive. Entries with no range are left alone.
 *
 * An entry whose stored content is gone also gets `availabilityLabel`, so the
 * row can say so before the user clicks it and finds nothing to diff.
 */
export function withAnchoringLabels(items: any[]): any[] {
    return (items ?? []).map(item => {
        if (item && Array.isArray(item.items)) {
            return { ...item, items: withAnchoringLabels(item.items) };
        }
        const label = describeRangeAnchoring(item);
        const availability = item?.contentMissing ? 'content unavailable' : undefined;
        if (!label && !availability) return item;
        return {
            ...item,
            ...(label ? { anchoringLabel: label } : {}),
            ...(availability ? { availabilityLabel: availability } : {})
        };
    });
}
