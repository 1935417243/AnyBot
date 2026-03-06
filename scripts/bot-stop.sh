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
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID"
  fi
  echo "机器人已停止（pid ${PID}）"
else
  echo "未找到机器人进程，正在清理过期的 pid 文件"
fi

rm -f "$PROJECT_DIR/$PID_FILE"
