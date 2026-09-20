import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { signaling } from '../signaling';
import { AudioCallSession, isWebRTCNativeAvailable } from '../webrtc';

type Props = {
  duration: number;
  preferListenerId?: string;
  onDone: (result: {
    callId?: string;
    listenerId?: string;
    status: string;
    billableSeconds?: number;
  }) => void;
  onCancel: () => void;
};

export function CallFlowScreen({ duration, preferListenerId, onDone, onCancel }: Props) {
  const [phase, setPhase] = useState<'connecting' | 'ringing' | 'active' | 'failed'>('connecting');
  const [status, setStatus] = useState('Finding someone to talk to...');
  const [callId, setCallId] = useState<string | null>(null);
  const [listenerId, setListenerId] = useState<string | undefined>(preferListenerId);
  const [secondsLeft, setSecondsLeft] = useState(duration);
  const [muted, setMuted] = useState(false);
  const [failReason, setFailReason] = useState('');
  const sessionRef = useRef<AudioCallSession | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let unsub = () => {};
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      await signaling.connect();
      unsub = signaling.onMessage(async (msg) => {
        if (msg.type === 'call.matched') {
          setCallId(msg.call_id);
          setListenerId(msg.listener_id);
          setStatus('Connecting...');
          setPhase('ringing');
        }
        if (msg.type === 'call.accepted' || (msg.type === 'call.state' && msg.status === 'WEBRTC_NEGOTIATING')) {
          setStatus('Starting audio...');
          if (!startedRef.current && msg.call_id) {
            startedRef.current = true;
            const sess = new AudioCallSession(msg.call_id || callId!, true);
            sessionRef.current = sess;
            await sess.start();
          }
        }
        if (msg.type === 'call.state' && msg.status === 'ACTIVE') {
          setPhase('active');
          setStatus('Talking');
        }
        if (msg.type === 'webrtc.answer' || msg.type === 'webrtc.ice' || msg.type === 'webrtc.offer') {
          await sessionRef.current?.handleRemote(msg);
        }
        if (msg.type === 'call.failed' || (msg.type === 'call.ended' && msg.status === 'FAILED')) {
          setPhase('failed');
          setFailReason(msg.reason || 'CALL_FAILED');
        }
        if (msg.type === 'call.ended' && msg.status === 'COMPLETED') {
          await sessionRef.current?.stop();
          onDone({
            callId: msg.call_id,
            listenerId,
            status: 'COMPLETED',
            billableSeconds: msg.billable_seconds,
          });
        }
      });

      signaling.send({
        type: 'call.request',
        duration,
        listener_id: preferListenerId,
      });
    })();

    return () => {
      unsub();
      if (timer) clearInterval(timer);
      sessionRef.current?.stop();
    };
  }, [duration, preferListenerId]);

  useEffect(() => {
    if (phase !== 'active') return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          signaling.send({ type: 'call.end', call_id: callId });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, callId]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  if (phase === 'failed') {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.title}>Nobody available</Text>
        <Text style={styles.sub}>{failReason || 'Try again in a moment.'}</Text>
        <Pressable style={styles.btn} onPress={onCancel}>
          <Text style={styles.btnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  if (phase !== 'active') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color="#e85d04" />
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.hint}>Usually takes a few seconds.</Text>
        {!isWebRTCNativeAvailable() && (
          <Text style={styles.warn}>WebRTC stub mode — use a custom dev client for real audio.</Text>
        )}
        <Pressable style={styles.ghost} onPress={onCancel}>
          <Text style={styles.ghostText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, styles.center]}>
      <Text style={styles.peer}>Listener</Text>
      <Text style={styles.timer}>
        {mm}:{ss}
      </Text>
      <Text style={styles.status}>Speaking...</Text>
      <View style={styles.controls}>
        <Pressable
          style={styles.ctrl}
          onPress={() => {
            const next = !muted;
            setMuted(next);
            sessionRef.current?.setMuted(next);
          }}
        >
          <Text style={styles.ctrlText}>{muted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>
        <Pressable
          style={[styles.ctrl, styles.end]}
          onPress={() => signaling.send({ type: 'call.end', call_id: callId })}
        >
          <Text style={styles.ctrlText}>End</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1419', padding: 24 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#f4f1ea', fontSize: 24, fontWeight: '700', marginBottom: 8 },
  sub: { color: '#9ca3af', marginBottom: 24 },
  status: { color: '#f4f1ea', fontSize: 18, marginTop: 24 },
  hint: { color: '#6b7280', marginTop: 8 },
  warn: { color: '#fbbf24', marginTop: 16, textAlign: 'center', fontSize: 12 },
  peer: { color: '#9ca3af', fontSize: 16 },
  timer: { color: '#f4f1ea', fontSize: 56, fontWeight: '300', marginVertical: 24 },
  controls: { flexDirection: 'row', gap: 16, marginTop: 48 },
  ctrl: {
    backgroundColor: '#1a222c',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 999,
  },
  end: { backgroundColor: '#b91c1c' },
  ctrlText: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#e85d04', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '600' },
  ghost: { marginTop: 32 },
  ghostText: { color: '#6b7280' },
});
