// A stand-in for real source, opened by the integration suite so the
// TypeScript language features answer with genuine document symbols.

export class Greeter {
    private prefix = 'Hello';

    public greet(name: string): string {
        const trimmed = name.trim();
        const parts = [this.prefix, trimmed];
        if (trimmed.length === 0) {
            return this.prefix;
        }
        return parts.join(', ');
    }

    public farewell(name: string): string {
        const trimmed = name.trim();
        return `Goodbye, ${trimmed}`;
    }
}

export function standalone(value: number): number {
    const doubled = value * 2;
    return doubled + 1;
}
