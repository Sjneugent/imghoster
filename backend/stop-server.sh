#!/usr/bin/env bash
# Stop the ImgHoster Node.js server

PORT="${PORT:-3000}"
PID=$(lsof -ti :"$PORT" 2>/dev/null)

if [ -z "$PID" ]; then
  echo "No process found listening on port $PORT"
  exit 0
fi

echo "Killing process $PID on port $PORT"
kill "$PID" 2>/dev/null

sleep 1
if kill -0 "$PID" 2>/dev/null; then
  echo "Process still running, sending SIGKILL"
  kill -9 "$PID" 2>/dev/null
fi

echo "Server stopped"
