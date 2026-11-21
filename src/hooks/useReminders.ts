import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocationRecord, WorkItemRecord } from '../types';

export interface ActiveReminder {
  item: WorkItemRecord;
  minutesUntilStart: number; // negative means overdue / already started
  locationName: string;
}

function playSoftChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.46);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export function useReminders(
  workItems: WorkItemRecord[],
  locationsMap: Map<string, LocationRecord>,
  soundEnabled: boolean
) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [snoozedUntil, setSnoozedUntil] = useState<Record<string, number>>({});
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const activeReminders = useMemo<ActiveReminder[]>(() => {
    const nowMs = now.getTime();
    const list: ActiveReminder[] = [];

    for (const item of workItems) {
      if (item.status === 'completed' || item.status === 'cancelled') continue;
      if (item.reminderDismissed) continue;

      const snoozeTarget = snoozedUntil[item.id] ?? 0;
      if (snoozeTarget > nowMs) continue;

      const startDt = new Date(`${item.scheduledDate}T${item.startTime}:00`);
      if (Number.isNaN(startDt.getTime())) continue;

      const diffMinutes = Math.round((startDt.getTime() - nowMs) / 60000);
      const triggerWindow = Math.max(5, item.reminderMinutes || 15);

      // Alert if within reminder window before start OR overdue up to 24 hours
      if (diffMinutes <= triggerWindow && diffMinutes >= -1440) {
        const loc = locationsMap.get(item.locationId);
        list.push({
          item,
          minutesUntilStart: diffMinutes,
          locationName: loc ? `${loc.code} · ${loc.name}` : 'Chưa xác định địa điểm',
        });
      }
    }

    return list.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);
  }, [workItems, locationsMap, now, snoozedUntil]);

  useEffect(() => {
    for (const rem of activeReminders) {
      if (notifiedIdsRef.current.has(rem.item.id)) continue;
      notifiedIdsRef.current.add(rem.item.id);

      if (soundEnabled) {
        playSoftChime();
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const timingText =
          rem.minutesUntilStart > 0
            ? `Còn ${rem.minutesUntilStart} phút nữa (${rem.item.startTime})`
            : rem.minutesUntilStart === 0
              ? `Đến giờ thực hiện (${rem.item.startTime})`
              : `Đã quá giờ ${Math.abs(rem.minutesUntilStart)} phút`;
        try {
          new Notification(`[${rem.item.code}] ${rem.item.title}`, {
            body: `${timingText} — ${rem.locationName}`,
            tag: rem.item.id,
          });
        } catch {
          // Ignore notification failure in restricted iframe
        }
      }
    }
  }, [activeReminders, soundEnabled]);

  const snoozeReminder = (id: string, minutes = 10) => {
    setSnoozedUntil((prev) => ({
      ...prev,
      [id]: Date.now() + minutes * 60000,
    }));
  };

  return {
    now,
    activeReminders,
    snoozeReminder,
  };
}
