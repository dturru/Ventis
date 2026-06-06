# Ventis nightly backup wrapper (for Task Scheduler). Sets the sheet id + runs the
# full refresh+backup. The sheet ID is not secret (the private SA key gates access).
$env:VENTIS_SHEET_ID = '15IQSI9mG0o6kSeN0dp9yeawykIrqkdpGZJJCR8DcBxU'
python 'C:\Users\turru\Projects\ventis\site\scripts\refresh_backup.py'
