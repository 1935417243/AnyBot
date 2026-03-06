#!/bin/sh
set -eu

RUN_DIR=".run"
PID_FILE="$RUN_DIR/bot.pid"
LOG_FILE="$RUN_DIR/bot.log"
PROJECT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

mkdir -p "$PROJECT_DIR/$RUN_DIR"

if [ -f "$PROJECT_DIR/$PID_FILE" ]; then
  PID="$(cat "$PROJECT_DIR/$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "机器人已在运行（pid ${PID}）"
    exit 0
  fi
  rm -f "$PROJECT_DIR/$PID_FILE"
fi

(
  cd "$PROJECT_DIR"
  nohup npx tsx src/index.ts >>"$LOG_FILE" 2>&1 </dev/null &
  echo "$!" >"$PID_FILE"
)
PID="$(cat "$PROJECT_DIR/$PID_FILE")"
echo "机器人已启动（pid ${PID}）"
echo "日志文件：$PROJECT_DIR/$LOG_FILE"
