from datetime import datetime
import math

def get_diff_days(start_str, target_str):
    d1 = datetime.strptime(start_str, "%Y-%m-%d")
    d2 = datetime.strptime(target_str, "%Y-%m-%d")
    return (d2 - d1).days

def date_to_x(target_str, start_str, unit, day_w=40, week_w=105):
    diff = get_diff_days(start_str, target_str)
    px = day_w if unit == 'day' else (week_w / 7.0)
    return round(diff * px, 2)

def bar_width(start_str, finish_str, unit, day_w=40, week_w=105):
    diff = max(1, get_diff_days(start_str, finish_str))
    px = day_w if unit == 'day' else (week_w / 7.0)
    return round(diff * px, 2)

base = "2026-10-01"
print("--- KIEM THU 3 MOC TINH TAY T-30 ---")

# Moc 1: Khởi công -> X = 0
assert date_to_x("2026-10-01", base, "day") == 0
assert date_to_x("2026-10-01", base, "week") == 0
print("✓ Moc 1 (Khoi cong): PASS")

# Moc 2: Sau 7 ngay -> Day = 280px, Week = 105px
assert date_to_x("2026-10-08", base, "day") == 280
assert date_to_x("2026-10-08", base, "week") == 105
print("✓ Moc 2 (Sau 7 ngay): PASS")

# Moc 3: Sau 14 ngay, dai 5 ngay
assert date_to_x("2026-10-15", base, "day") == 560
assert bar_width("2026-10-15", "2026-10-20", "day") == 200
assert bar_width("2026-10-15", "2026-10-20", "week") == 75
print("✓ Moc 3 (Sau 14 ngay & do rong 5 ngay): PASS")

print("===> TAT CA 3 MOC TINH TAY T-30 DA PASS 100%!")
