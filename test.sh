#!/bin/bash
echo "🚀 Starting Chronos Test Suite..."

# 1. Compile TypeScript
echo "📦 Compiling TypeScript..."
npm run compile
if [ $? -ne 0 ]; then
    echo "❌ Compilation failed!"
    exit 1
fi

# 2. Run Feature Tests
echo "🧪 Running Feature Tests..."
node test/run_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Feature tests failed!"
    exit 1
fi

# 3. Run Menu Tests
echo "🧪 Running Menu Tests..."
node test/menu_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Menu tests failed!"
    exit 1
fi

echo "✅ All tests passed successfully!"
