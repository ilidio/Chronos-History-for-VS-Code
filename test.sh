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

echo "🧪 Running Pro Features Tests..."
node test/pro_features_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Pro Feature tests failed!"
    exit 1
fi

echo "🧪 Running Comparison Tests..."
node test/comparison_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Comparison tests failed!"
    exit 1
fi

echo "🧪 Running Git Parser Tests..."
node test/git_parser_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Git Parser tests failed!"
    exit 1
fi

echo "🧪 Running Path Matching Tests..."
node test/path_matching_tests.js
if [ $? -ne 0 ]; then
    echo "❌ Path Matching tests failed!"
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
