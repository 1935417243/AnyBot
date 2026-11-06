// 自动化 cron 表达式解析，规则与服务端 src/web/services/automations.ts 的 computeCronNextRunAt 保持一致：
// 5 段「分 时 日 月 周」，支持 *、数字、a-b 范围、逗号列表和 /步长，周字段 0 或 7 表示周日，
// 日和周同时满足才触发，最多向后查找一年。

// 向后查找的最大分钟数（一年）
const CRON_MAX_SEARCH_MINUTES = 366 * 24 * 60;

// cron 字段中的单个非负整数（取值或步长）
const CRON_NUMBER_PATTERN = /^\d+$/;

// cron 字段中的 a-b 范围
const CRON_RANGE_PATTERN = /^(\d+)-(\d+)$/;

// 解析 cron 单个字段，返回允许取值的集合；字段非法时返回 null
function parseCronPart(part, min, max, sunday7) {
    var values = new Set();
    var segments = part.split(',');
    for (var i = 0; i < segments.length; i += 1) {
        var segment = segments[i].trim();
        if (!segment) return null;
        var pieces = segment.split('/');
        if (pieces.length > 2) return null;
        var rangePart = pieces[0];
        // 取值和步长只接受纯数字，避免 Number() 把空串、十六进制、科学计数法等非法写法静默转成数字
        if (pieces.length > 1 && !CRON_NUMBER_PATTERN.test(pieces[1])) return null;
        var step = pieces.length > 1 ? Number(pieces[1]) : 1;
        if (step <= 0) return null;
        var start;
        var end;
        var rangeMatch = CRON_RANGE_PATTERN.exec(rangePart);
        if (rangePart === '*') {
            start = min;
            end = max;
        } else if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
        } else if (CRON_NUMBER_PATTERN.test(rangePart)) {
            start = Number(rangePart);
            // 单个数字带步长（如 0/5）按常见约定视为从该值到字段上限，等价于 0-59/5
            end = pieces.length > 1 ? max : start;
        } else {
            return null;
        }
        if (sunday7) {
            if (start === 7) start = 0;
            if (end === 7) end = 0;
        }
        if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
        if (start < min || start > max || end < min || end > max) return null;
        var value;
        if (start <= end) {
            for (value = start; value <= end; value += step) values.add(value);
        } else {
            for (value = start; value <= max; value += step) values.add(value);
            for (value = min; value <= end; value += step) values.add(value);
        }
    }
    return values;
}

// 计算 cron 表达式在 from 之后的下一次触发时间（毫秒时间戳，本地时区）；表达式无效或一年内不会触发时返回 null
export function computeCronNextRunAt(cron, from) {
    var parts = String(cron || '').trim().split(/\s+/);
    if (parts.length !== 5) return null;
    var minutes = parseCronPart(parts[0], 0, 59, false);
    var hours = parseCronPart(parts[1], 0, 23, false);
    var days = parseCronPart(parts[2], 1, 31, false);
    var months = parseCronPart(parts[3], 1, 12, false);
    var weekdays = parseCronPart(parts[4], 0, 6, true);
    if (!minutes || !hours || !days || !months || !weekdays) return null;

    var cursor = new Date(from == null ? Date.now() : from);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    for (var i = 0; i < CRON_MAX_SEARCH_MINUTES; i += 1) {
        if (
            minutes.has(cursor.getMinutes()) &&
            hours.has(cursor.getHours()) &&
            days.has(cursor.getDate()) &&
            months.has(cursor.getMonth() + 1) &&
            weekdays.has(cursor.getDay())
        ) {
            return cursor.getTime();
        }
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return null;
}
