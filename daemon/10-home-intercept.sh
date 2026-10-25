#!/bin/sh
# /var/lib/webosbrew/init.d/10-home-intercept.sh
# LG webOS Home Interceptor & Power-On App Manager

if [ "$1" != "daemon" ]; then
    nohup /bin/sh "$0" daemon >/tmp/home-intercept.log 2>&1 &
    exit 0
fi

echo "[$(date)] Interceptor & Power-on daemon started" >> /tmp/home-intercept.log

# Flag for cold boot
touch /tmp/tv_boot_pending

# 1. Fallback timer for cold boot (12s after daemon start)
(
    sleep 12
    if [ -f /tmp/tv_boot_pending ]; then
        rm -f /tmp/tv_boot_pending
        if [ -f /var/lib/webosbrew/power_on_app ]; then
            TARGET=$(cat /var/lib/webosbrew/power_on_app 2>/dev/null | tr -d '\r\n ')
            if [ -n "$TARGET" ] && [ "$TARGET" != "com.webos.app.livetv" ]; then
                echo "[$(date)] Fallback timer launching power-on app: $TARGET" >> /tmp/home-intercept.log
                luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
            fi
        fi
    fi
) &

# 2. Standby resume handler (for Quick Start+)
(
    while true; do
        luna-send -i luna://com.webos.service.tvpower/power/getPowerState '{"subscribe":true}' 2>/dev/null | while read -r line; do
            case "$line" in
                *'"state":"Suspend"'*|*'"state":"ActiveStandby"'*|*'"state":"Screen Off"'*|*'"state":"PrepareSuspend"'*)
                    touch /tmp/tv_is_standby
                    ;;
                *'"state":"Active"'*)
                    if [ -f /tmp/tv_is_standby ]; then
                        rm -f /tmp/tv_is_standby
                        echo "[$(date)] Standby resume detected" >> /tmp/home-intercept.log
                        sleep 2
                        if [ -f /var/lib/webosbrew/power_on_app ]; then
                            TARGET=$(cat /var/lib/webosbrew/power_on_app 2>/dev/null | tr -d '\r\n ')
                            if [ -n "$TARGET" ] && [ "$TARGET" != "com.webos.app.livetv" ]; then
                                echo "[$(date)] Standby launching: $TARGET" >> /tmp/home-intercept.log
                                luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
                            fi
                        fi
                    fi
                    ;;
            esac
        done
        sleep 2
    done
) &

# 3. Foreground app listener: handles Home button + Cold boot trigger
while true; do
    luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null | while read -r line; do
        case "$line" in
            *'"appId":"com.webos.app.home"'*)
                echo "[$(date)] Detected Home button -> Opening Free My TV" >> /tmp/home-intercept.log
                luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"io.freemytv"}' >/dev/null 2>&1
                ;;
            *'"appId":"com.webos.app.livetv"'*)
                if [ -f /tmp/tv_boot_pending ]; then
                    rm -f /tmp/tv_boot_pending
                    if [ -f /var/lib/webosbrew/power_on_app ]; then
                        TARGET=$(cat /var/lib/webosbrew/power_on_app 2>/dev/null | tr -d '\r\n ')
                        if [ -n "$TARGET" ] && [ "$TARGET" != "com.webos.app.livetv" ]; then
                            echo "[$(date)] Cold-boot LiveTV detected -> Launching $TARGET" >> /tmp/home-intercept.log
                            sleep 1.5
                            luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
                        fi
                    fi
                fi
                ;;
        esac
    done
    sleep 2
done
