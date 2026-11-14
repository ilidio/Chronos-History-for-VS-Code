"use strict";
// A stand-in for real source, opened by the integration suite so the
// TypeScript language features answer with genuine document symbols.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Greeter = void 0;
exports.standalone = standalone;
class Greeter {
    constructor() {
        this.prefix = 'Hello';
    }
    greet(name) {
        const trimmed = name.trim();
        const parts = [this.prefix, trimmed];
        if (trimmed.length === 0) {
            return this.prefix;
        }
        return parts.join(', ');
    }
    farewell(name) {
        const trimmed = name.trim();
        return `Goodbye, ${trimmed}`;
    }
}
exports.Greeter = Greeter;
function standalone(value) {
    const doubled = value * 2;
    return doubled + 1;
}
//# sourceMappingURL=sample.js.map