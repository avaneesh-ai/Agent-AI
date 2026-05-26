#!/bin/zsh
cd "$(dirname "$0")"

echo "Starting Secure Entry shared server..."
echo "Keep this window open while users are logging in."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or cannot be found."
  echo "Install Node.js, then open this file again."
  echo ""
  echo "Press Return to close."
  read
  exit 1
fi

npm start

echo ""
echo "Secure Entry stopped."
echo "Press Return to close."
read
