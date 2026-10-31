#!/bin/sh
# /var/lib/webosbrew/init.d/10-home-intercept.sh
# LG webOS Home Interceptor & Power-On App Manager

LOG_FILE="/tmp/home-intercept.log"

log_msg() {
    # Rotate log in /tmp (RAM) if it exceeds 32 KB
    if [ -f "$LOG_FILE" ]; then
        LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
        if [ "$LOG_SIZE" -gt 32768 ]; then
            tail -n 50 "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
        fi
    fi
    echo "[$(date)] $1" >> "$LOG_FILE"
}

read_power_on_target() {
    if [ ! -f /var/lib/webosbrew/power_on_app ]; then
        return 1
    fi
    TARGET=$(tr -d '\r\n ' < /var/lib/webosbrew/power_on_app 2>/dev/null)
    case "$TARGET" in
        ""|"com.webos.app.livetv"|*[!a-zA-Z0-9._-]*)
            return 1
            ;;
    esac
    echo "$TARGET"
    return 0
}

if [ "$1" != "daemon" ]; then
    nohup /bin/sh "$0" daemon >/dev/null 2>&1 &
    exit 0
fi

log_msg "Interceptor & Power-on daemon started"

# System-level RAM, Swap & Ad/Bloatware optimizations for 1.2GB RAM webOS TV
optimize_tv_system() {
    # 1. Tune Linux VM: reduce swap aggressiveness (from 100 to 60) and reclaim unused FAT32 dentry cache faster
    sysctl -w vm.swappiness=60 vm.vfs_cache_pressure=120 >/dev/null 2>&1 || true

    # 2. Block LG Ad & Telemetry servers in /tmp/hosts (bound to /etc/hosts by webosbrew)
    if [ -f /tmp/hosts ] && ! grep -q "ad.lgappstv.com" /tmp/hosts 2>/dev/null; then
        echo "127.0.0.1 ad.lgappstv.com ibs.lgappstv.com yumenetworks.com smartclip.net smartclip.com lal.lgappstv.com cdpbeacon.lgtvsdp.com" >> /tmp/hosts
        echo "::1 ad.lgappstv.com ibs.lgappstv.com yumenetworks.com smartclip.net smartclip.com lal.lgappstv.com cdpbeacon.lgtvsdp.com" >> /tmp/hosts
    fi

    # 3. Register Free My TV as the native webOS Default Home App & Keep-Alive app so the Home button never opens LG Home
    luna-send -n 1 luna://com.webos.applicationManager/setDefaultApp '{"category":"home","appId":"io.freemytv"}' >/dev/null 2>&1 || true
    luna-send -n 1 luna://com.webos.service.config/setConfigs '{"configs":{"com.webos.applicationManager.keepAliveApps":["io.freemytv","com.webos.app.livemenu","com.webos.app.voice"]}}' >/dev/null 2>&1 || true

    # 4. Stop LG admanager daemon and close background bloatware web apps & native LG Home if running
    killall -9 admanager 2>/dev/null || true
    for BLOAT_APP in com.webos.app.home com.webos.app.lgchannels yandex.alice amazon.alexapr; do
        luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$BLOAT_APP\"}" >/dev/null 2>&1 || true
    done
    ps -ef | grep -E 'app-id=(yandex\.alice|amazon\.alexapr|com\.webos\.app\.lgchannels)' | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

    # 5. Sync USB photos manifest once USB storage finishes mounting
    if [ -f /media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh ]; then
        /bin/sh /media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh >/dev/null 2>&1 || true
    fi
}

(
    sleep 6
    optimize_tv_system
    # Second pass after late-boot overlay apps (Alexa, Alice, LG Channels) spawn around 45-70s
    sleep 70
    optimize_tv_system
) &

# Flag for cold boot
touch /tmp/tv_boot_pending

# 1. Fallback timer for cold boot (12s after daemon start)
(
    sleep 12
    if [ -f /tmp/tv_boot_pending ]; then
        rm -f /tmp/tv_boot_pending
        if TARGET=$(read_power_on_target); then
            log_msg "Fallback timer launching power-on app: $TARGET"
            luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
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
                        log_msg "Standby resume detected"
                        sleep 2
                        if TARGET=$(read_power_on_target); then
                            log_msg "Standby launching: $TARGET"
                            luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
                        fi
                    fi
                    ;;
            esac
        done
        sleep 2
    done
) &

# 3. Foreground app listener: handles Home button + Cold boot trigger
LAST_HOME_TS=0
while true; do
    luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null | while read -r line; do
        case "$line" in
            *'"appId":"com.webos.app.home"'*)
                rm -f /tmp/tv_boot_pending
                NOW_TS=$(date +%s 2>/dev/null || echo 0)
                if [ $((NOW_TS - LAST_HOME_TS)) -ge 1 ]; then
                    LAST_HOME_TS=$NOW_TS
                    log_msg "Detected LG Home -> Redirecting to Free My TV"
                    luna-send -n 1 luna://com.webos.applicationManager/setDefaultApp '{"category":"home","appId":"io.freemytv"}' >/dev/null 2>&1 || true
                    luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"io.freemytv"}' >/dev/null 2>&1
                    (sleep 1; luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '{"id":"com.webos.app.home"}' >/dev/null 2>&1) &
                fi
                ;;
            *'"appId":"com.webos.app.livetv"'*)
                if [ -f /tmp/tv_boot_pending ]; then
                    rm -f /tmp/tv_boot_pending
                    if TARGET=$(read_power_on_target); then
                        log_msg "Cold-boot LiveTV detected -> Launching $TARGET"
                        sleep 1.5
                        luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TARGET\"}" >/dev/null 2>&1
                    fi
                fi
                ;;
        esac
    done
    sleep 2
done
