#!/bin/sh
set -eu

PID_FILE=".run/bot.pid"
PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

if [ ! -f "$PROJECT_DIR/$PID_FILE" ]; then
  echo "机器人未运行"
  exit 0
fi

PID="$(cat "$PROJECT_DIR/$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  echo "机器人运行中（pid ${PID}）"
else
  echo "机器人未运行，但存在过期的 pid 文件"
  exit 1
fi
