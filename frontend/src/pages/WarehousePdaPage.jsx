import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, apiErrorMessage } from '../api';
import { formatTime, translateError } from '../shared/ui.jsx';

const SCAN_ACTIONS = [
  { event_code: 'CHINA_DEPART', location: '中国仓', remark: '中国仓发车', labelKey: 'eventType.CHINA_DEPART' },
  { event_code: 'BORDER_ARRIVE', location: '瑞丽 / 木姐边境', remark: '包裹已到达边境', labelKey: 'eventType.BORDER_ARRIVE' },
  { event_code: 'CUSTOMS_CLEAR', location: '木姐口岸', remark: '包裹清关中', labelKey: 'eventType.CUSTOMS_CLEAR' },
  { event_code: 'MYANMAR_ARRIVE', location: '木姐', remark: '缅甸物流扫码接货', labelKey: 'eventType.MYANMAR_ARRIVE' },
  { event_code: 'DISPATCH', location: '派送中', remark: '包裹正在派送', labelKey: 'eventType.DISPATCH' },
  { event_code: 'DELIVER', location: '客户已签收', remark: '签收完成', labelKey: 'eventType.DELIVER' },
];

const NEXT_ACTION_BY_STATUS = {
  WAREHOUSE_RECEIVED: 'CHINA_DEPART',
  CHINA_TRANSIT: 'BORDER_ARRIVE',
  AT_BORDER: 'CUSTOMS_CLEAR',
  CUSTOMS_CLEARANCE: 'MYANMAR_ARRIVE',
  MYANMAR_TRANSIT: 'DISPATCH',
  OUT_FOR_DELIVERY: 'DELIVER',
};

function getActionKey(action) {
  return action ? action.event_code : '';
}

function getNextAction(status) {
  return SCAN_ACTIONS.find((item) => getActionKey(item) === NEXT_ACTION_BY_STATUS[status]) || null;
}

function getNextActionLabel(t, status) {
  const action = getNextAction(status);
  return action ? t(action.labelKey) : t('scan.noNextAction');
}

function isActionAllowed(action, status) {
  if (!action || !status) return false;
  return getActionKey(action) === NEXT_ACTION_BY_STATUS[status];
}

function normalizeScanValue(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export default function WarehousePdaPage({ navigate, active }) {
  const { t } = useTranslation();
  const [trackingNo, setTrackingNo] = useState('');
  const [action, setAction] = useState('AT_BORDER');
  const [shipment, setShipment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [lastError, setLastError] = useState('');
  const [scannerRunning, setScannerRunning] = useState(false);
  const [cameraMode, setCameraMode] = useState('idle');
  const [continuousScan, setContinuousScan] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [pendingBatch, setPendingBatch] = useState(() => JSON.parse(localStorage.getItem('hx_mm_pending_batch') || '[]'));
  const [batchProgress, setBatchProgress] = useState(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [recentScans, setRecentScans] = useState(() => JSON.parse(localStorage.getItem('hx_mm_recent_scans') || '[]'));
  const [failedQueue, setFailedQueue] = useState(() => JSON.parse(localStorage.getItem('hx_mm_scan_queue') || '[]'));
  const scannerRef = useRef(null);
  const scannerModuleRef = useRef(null);
  const scannerRunningRef = useRef(false);
  const startingScannerRef = useRef(false);
  const shouldRestartCameraRef = useRef(false);
  const activeRef = useRef(active);
  const continuousScanRef = useRef(continuousScan);
  const batchModeRef = useRef(batchMode);
  const lastDecodedRef = useRef({ value: '', time: 0 });
  const trackingInputRef = useRef(null);
  const audioContextRef = useRef(null);
  const lastSubmitRef = useRef({ trackingNo: '', action: '', time: 0 });
  const isWebKitMobile = /iP(hone|ad|od)|AppleWebKit/i.test(navigator.userAgent) && /Mobile|CriOS|FxiOS|Telegram/i.test(navigator.userAgent);

  const focusScanInput = useCallback(() => {
    window.setTimeout(() => {
      if (!activeRef.current) return;
      trackingInputRef.current?.focus({ preventScroll: true });
    }, 40);
  }, []);

  const playBeep = useCallback((type = 'success') => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContextRef.current ||= new AudioContext();
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') audioContext.resume();
      const pattern = type === 'success'
        ? [{ frequency: 880, start: 0, duration: 0.09 }]
        : [
            { frequency: 220, start: 0, duration: 0.08 },
            { frequency: 220, start: 0.12, duration: 0.08 },
          ];
      pattern.forEach((item) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(item.frequency, audioContext.currentTime + item.start);
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime + item.start);
        gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + item.start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + item.start + item.duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + item.start);
        oscillator.stop(audioContext.currentTime + item.start + item.duration + 0.02);
      });
    } catch {
      // Audio feedback is best-effort, especially in iOS WebView.
    }
  }, []);

  const addToPendingBatch = useCallback((value) => {
    const normalizedTrackingNo = normalizeScanValue(value);
    if (!normalizedTrackingNo) {
      focusScanInput();
      return false;
    }
    setPendingBatch((items) => {
      if (items.some((item) => item.tracking_no === normalizedTrackingNo)) return items;
      return [{ tracking_no: normalizedTrackingNo, status: '待提交', added_at: new Date().toISOString() }, ...items].slice(0, 300);
    });
    setTrackingNo('');
    setShipment(null);
    setBatchProgress(null);
    setToast(`已加入待处理队列：${normalizedTrackingNo}`);
    playBeep('success');
    navigator.vibrate?.(60);
    focusScanInput();
    return true;
  }, [focusScanInput, playBeep]);

  useEffect(() => {
    activeRef.current = active;
    if (active) focusScanInput();
  }, [active, focusScanInput]);

  useEffect(() => {
    continuousScanRef.current = continuousScan;
  }, [continuousScan]);

  useEffect(() => {
    batchModeRef.current = batchMode;
  }, [batchMode]);

  useEffect(() => {
    localStorage.setItem('hx_mm_pending_batch', JSON.stringify(pendingBatch.slice(0, 300)));
  }, [pendingBatch]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (shipment?.current_status) {
      const next = getNextAction(shipment.current_status);
      if (next) setAction(getActionKey(next));
    }
  }, [shipment?.current_status]);

  useEffect(() => {
    localStorage.setItem('hx_mm_recent_scans', JSON.stringify(recentScans.slice(0, 20)));
  }, [recentScans]);

  useEffect(() => {
    localStorage.setItem('hx_mm_scan_queue', JSON.stringify(failedQueue.slice(0, 50)));
  }, [failedQueue]);

  const stopScanner = useCallback(async (nextMode = 'idle') => {
    const scanner = scannerRef.current;
    scannerRunningRef.current = false;
    setScannerRunning(false);
    setTorchOn(false);
    setTorchSupported(false);
    try {
      await scanner?.stop?.();
    } catch {
      // Safari may already have stopped the stream during pagehide.
    }
    try {
      await scanner?.clear?.();
    } catch {
      // The scanner DOM can be gone after route changes.
    }
    const video = document.querySelector('#qr-reader video');
    const stream = video?.srcObject;
    stream?.getTracks?.().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    scannerRef.current = null;
    setCameraMode(nextMode);
    focusScanInput();
  }, [focusScanInput]);

  useEffect(() => {
    if (!active) stopScanner();
  }, [active, stopScanner]);

  const startScanner = useCallback(async () => {
    setMessage('');
    focusScanInput();
    if (startingScannerRef.current || scannerRunningRef.current) return;
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setMessage(t('scan.httpsRequired'));
      setCameraMode('error');
      playBeep('error');
      focusScanInput();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(t('scan.cameraUnavailable'));
      setCameraMode('error');
      playBeep('error');
      focusScanInput();
      return;
    }

    try {
      startingScannerRef.current = true;
      await stopScanner();
      setCameraMode('starting');
      setMessage(t('scan.loadingCamera'));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      scannerModuleRef.current ||= await import('html5-qrcode');
      const { Html5Qrcode } = scannerModuleRef.current;
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: isWebKitMobile ? 5 : 8, qrbox: { width: isWebKitMobile ? 220 : 240, height: isWebKitMobile ? 220 : 240 } },
        async (decodedText) => {
          const value = normalizeScanValue(decodedText);
          const now = Date.now();
          if (lastDecodedRef.current.value === value && now - lastDecodedRef.current.time < 1200) return;
          lastDecodedRef.current = { value, time: now };
          setTrackingNo(value);
          setShipment(null);
          setToast(t('scan.recognized'));
          focusScanInput();
          if (batchModeRef.current) {
            addToPendingBatch(value);
          } else {
            playBeep('success');
            navigator.vibrate?.(80);
            inboundScan(value);
          }
          if (!continuousScanRef.current) await stopScanner();
        }
      );
      scannerRunningRef.current = true;
      setScannerRunning(true);
      setCameraMode('running');
      setMessage('');
      focusScanInput();
      const video = document.querySelector('#qr-reader video');
      video?.setAttribute('playsinline', 'true');
      video?.setAttribute('webkit-playsinline', 'true');
      const track = video?.srcObject?.getVideoTracks?.()[0];
      setTorchSupported(Boolean(track?.getCapabilities?.().torch));
    } catch {
      await stopScanner('error');
      setMessage(isWebKitMobile ? t('scan.safariCameraHint') : t('scan.cameraUnavailable'));
      playBeep('error');
      focusScanInput();
    } finally {
      startingScannerRef.current = false;
    }
  }, [addToPendingBatch, focusScanInput, isWebKitMobile, playBeep, stopScanner, t]);

  async function toggleTorch() {
    const video = document.querySelector('#qr-reader video');
    const track = video?.srcObject?.getVideoTracks?.()[0];
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
      focusScanInput();
    } catch {
      setMessage(t('scan.torchUnavailable'));
      playBeep('error');
      focusScanInput();
    }
  }

  useEffect(() => {
    const suspendCamera = () => {
      shouldRestartCameraRef.current = scannerRunningRef.current;
      stopScanner();
    };
    const resumeCamera = () => {
      if (!activeRef.current || !shouldRestartCameraRef.current) {
        focusScanInput();
        return;
      }
      shouldRestartCameraRef.current = false;
      window.setTimeout(() => {
        if (activeRef.current) startScanner();
      }, 250);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') suspendCamera();
      if (document.visibilityState === 'visible') resumeCamera();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', suspendCamera);
    window.addEventListener('pageshow', resumeCamera);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', suspendCamera);
      window.removeEventListener('pageshow', resumeCamera);
      stopScanner();
    };
  }, [focusScanInput, startScanner, stopScanner]);

  async function submit(event) {
    event.preventDefault();
    if (batchMode) {
      addToPendingBatch(trackingNo);
      return;
    }
    await submitScan({ trackingNo: normalizeScanValue(trackingNo), actionKey: nextAction ? getActionKey(nextAction) : action, enqueueOnFailure: true });
  }

  async function submitScan({ trackingNo: targetTrackingNo, actionKey, enqueueOnFailure }) {
    setMessage('');
    setLastError('');
    const normalizedTrackingNo = normalizeScanValue(targetTrackingNo);
    const now = Date.now();
    if (
      lastSubmitRef.current.trackingNo === normalizedTrackingNo &&
      lastSubmitRef.current.action === actionKey &&
      now - lastSubmitRef.current.time < 1800
    ) {
      setToast(t('scan.duplicateBlocked'));
      playBeep('error');
      focusScanInput();
      return false;
    }
    setLoading(true);
    try {
      lastSubmitRef.current = { trackingNo: normalizedTrackingNo, action: actionKey, time: now };
      const selectedAction = SCAN_ACTIONS.find((item) => getActionKey(item) === actionKey);
      if (!selectedAction) {
        setMessage(t('errors.invalidScanAction'));
        playBeep('error');
        focusScanInput();
        return false;
      }
      if (shipment?.current_status && !isActionAllowed(selectedAction, shipment.current_status)) {
        setMessage(t('errors.invalidTransitionWithNext', {
          status: t(`status.${shipment.current_status}`),
          next: getNextActionLabel(t, shipment.current_status),
        }));
        playBeep('error');
        focusScanInput();
        return false;
      }
      const response = await apiClient.post('/tracking_events', {
        tracking_no: normalizedTrackingNo,
        event_code: selectedAction.event_code,
        event_city: selectedAction.location,
        event_description: selectedAction.remark,
        source_type: 'scan',
      });
      const nextShipment = response.data.shipment || response.data;
      setShipment(nextShipment);
      setTrackingNo('');
      setRecentScans((items) => [{
        tracking_no: nextShipment.tracking_no,
        status: nextShipment.current_status,
        location: nextShipment.current_location,
        time: new Date().toISOString(),
      }, ...items.filter((item) => item.tracking_no !== nextShipment.tracking_no)].slice(0, 20));
      setToast(t('scan.updatedWithStatus', { status: t(`status.${nextShipment.current_status}`), location: nextShipment.current_location }));
      playBeep('success');
      navigator.vibrate?.([80, 40, 80]);
      focusScanInput();
      return true;
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err), shipment);
      setMessage(text);
      setLastError(text);
      playBeep('error');
      focusScanInput();
      if (enqueueOnFailure && (!navigator.onLine || err.code === 'ECONNABORTED' || err.message === 'Network Error')) {
        setFailedQueue((items) => [{
          trackingNo: normalizedTrackingNo,
          action: actionKey,
          createdAt: new Date().toISOString(),
        }, ...items].slice(0, 50));
        setToast(t('scan.queued'));
      }
      return false;
    } finally {
      setLoading(false);
      focusScanInput();
    }
  }

  async function submitPendingBatch() {
    if (!pendingBatch.length) {
      focusScanInput();
      return;
    }
    setLoading(true);
    setMessage('');
    setLastError('');
    setBatchProgress({ total: pendingBatch.length, success: 0, failure: 0, results: [] });
    try {
      const response = await apiClient.post('/tracking_events/batch', {
        source_type: 'scan',
        events: pendingBatch.map((item) => ({
          tracking_no: item.tracking_no,
          event_code: 'WAREHOUSE_RECEIVE',
          event_city: '中国仓',
          event_description: '仓库已收货',
          external_ref: `batch-receive-${item.tracking_no}-${item.added_at}`,
        })),
      });
      const data = response.data;
      setBatchProgress({
        total: data.total,
        success: data.success_count,
        failure: data.failure_count,
        results: data.results || [],
      });
      setPendingBatch([]);
      setToast(`批次提交完成：成功 ${data.success_count} 条，失败 ${data.failure_count} 条`);
      playBeep(data.failure_count ? 'error' : 'success');
      focusScanInput();
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err));
      setMessage(text);
      setLastError(text);
      playBeep('error');
      focusScanInput();
    } finally {
      setLoading(false);
      focusScanInput();
    }
  }

  async function checkShipment() {
    await loadShipment(normalizeScanValue(trackingNo));
  }

  async function inboundScan(targetTrackingNo = trackingNo) {
    const normalizedTrackingNo = normalizeScanValue(targetTrackingNo);
    if (!normalizedTrackingNo) {
      focusScanInput();
      return;
    }
    if (batchModeRef.current) {
      addToPendingBatch(normalizedTrackingNo);
      return;
    }
    setMessage('');
    setLastError('');
    setLoading(true);
    try {
      const response = await apiClient.post('/shipments/inbound-scan', {
        tracking_no: normalizedTrackingNo,
        warehouse_name: '中国仓',
      });
      const nextShipment = response.data.shipment;
      setShipment(nextShipment);
      setTrackingNo('');
      setRecentScans((items) => [{
        tracking_no: nextShipment.tracking_no,
        status: nextShipment.status || nextShipment.current_status,
        location: nextShipment.current_node || nextShipment.current_location,
        time: new Date().toISOString(),
      }, ...items.filter((item) => item.tracking_no !== nextShipment.tracking_no)].slice(0, 20));
      setToast(response.data.created ? t('scan.inboundCreated') : t('scan.inboundDuplicate'));
      playBeep('success');
      navigator.vibrate?.([80, 40, 80]);
      focusScanInput();
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err), shipment);
      setMessage(text);
      setLastError(text);
      playBeep('error');
      focusScanInput();
    } finally {
      setLoading(false);
      focusScanInput();
    }
  }

  async function loadShipment(targetTrackingNo) {
    const normalizedTrackingNo = normalizeScanValue(targetTrackingNo);
    if (!normalizedTrackingNo) {
      focusScanInput();
      return;
    }
    setMessage('');
    setLastError('');
    setLoading(true);
    try {
      const response = await apiClient.get(`/shipment/${normalizedTrackingNo}`);
      const nextShipment = response.data.shipment || response.data;
      setShipment(nextShipment);
      setToast(t('scan.loadedCurrent', { status: t(`status.${nextShipment.current_status}`) }));
      focusScanInput();
    } catch (err) {
      const text = translateError(t, apiErrorMessage(err));
      setMessage(text);
      setLastError(text);
      playBeep('error');
      focusScanInput();
    } finally {
      setLoading(false);
      focusScanInput();
    }
  }

  async function retryLast() {
    if (!trackingNo.trim()) {
      focusScanInput();
      return;
    }
    if (lastError) {
      await checkShipment();
    }
  }

  async function retryQueueItem(item) {
    const ok = await submitScan({ trackingNo: item.trackingNo, actionKey: item.action, enqueueOnFailure: false });
    if (ok) setFailedQueue((items) => items.filter((queued) => queued.createdAt !== item.createdAt));
    focusScanInput();
  }

  function handleScanInputBlur() {
    if (!activeRef.current) return;
    focusScanInput();
  }

  function removePendingBatchItem(trackingNoToRemove) {
    setPendingBatch((items) => items.filter((item) => item.tracking_no !== trackingNoToRemove));
    focusScanInput();
  }

  const nextAction = shipment?.current_status ? getNextAction(shipment.current_status) : null;
  const selectedAction = nextAction || SCAN_ACTIONS.find((item) => getActionKey(item) === action);
  const actionAllowed = shipment?.current_status ? Boolean(nextAction) : true;
  const canSubmitNextAction = batchMode
    ? Boolean(trackingNo.trim())
    : Boolean(trackingNo.trim() && shipment && nextAction && isActionAllowed(nextAction, shipment.current_status));

  return (
    <section className="scan-layout">
      {toast && <div className="toast">{toast}</div>}
      <form className="panel form-stack" onSubmit={submit}>
        <h1>{t('scan.title')}</h1>
        <label className="toggle-row batch-mode-toggle">
          <input type="checkbox" checked={batchMode} onChange={(e) => {
            setBatchMode(e.target.checked);
            setBatchProgress(null);
            focusScanInput();
          }} />
          <span>批量模式</span>
        </label>
        <p className="muted compact-help">{batchMode ? '批量模式开启后，扫描的物流单号会进入待处理队列，不会立即提交。' : t('scan.mobileHelp')}</p>
        {shipment && !batchMode && (
          <div className="current-scan-status">
            <span>{t('shipment.currentStatus')}</span>
            <strong>{t(`status.${shipment.current_status}`)}</strong>
            <small>{t('scan.nextRecommended')}: {getNextActionLabel(t, shipment.current_status)}</small>
          </div>
        )}
        <label htmlFor="scanTrackingNo">{t('scan.manualInput')}</label>
        <div className="scan-input-row">
          <input
            ref={trackingInputRef}
            id="scanTrackingNo"
            value={trackingNo}
            onChange={(e) => {
              setTrackingNo(e.target.value.trimStart());
              setShipment(null);
              setMessage('');
            }}
            onBlur={handleScanInputBlur}
            placeholder={t('query.placeholder')}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
          <button type="button" className="camera-button" onClick={scannerRunning ? () => stopScanner() : startScanner} disabled={cameraMode === 'starting'} aria-label={scannerRunning ? t('scan.stopCamera') : t('scan.startCamera')}>
            <span aria-hidden="true">📷</span>
            <small>{cameraMode === 'starting' ? t('scan.openingCamera') : scannerRunning ? t('scan.stopCameraShort') : t('scan.camera')}</small>
          </button>
        </div>
        {(cameraMode === 'starting' || cameraMode === 'running') && (
          <div className={`scanner-box ${cameraMode}`}>
            {cameraMode === 'starting' && <div className="camera-placeholder">{t('scan.loadingCamera')}</div>}
            <div id="qr-reader" />
          </div>
        )}
        {cameraMode === 'error' && (
          <div className="camera-fallback">
            <strong>{t('scan.cameraFailedTitle')}</strong>
            <span>{isWebKitMobile ? t('scan.safariCameraHint') : t('scan.cameraUnavailable')}</span>
            <button type="button" className="ghost-button" onClick={startScanner}>{t('scan.cameraRetry')}</button>
          </div>
        )}
        {cameraMode === 'running' && (
          <div className="button-row camera-controls">
            <button type="button" className="ghost-button" onClick={toggleTorch} disabled={!torchSupported}>{torchOn ? t('scan.torchOff') : t('scan.torchOn')}</button>
            <label className="toggle-row">
              <input type="checkbox" checked={continuousScan} onChange={(e) => setContinuousScan(e.target.checked)} />
              <span>{t('scan.continuous')}</span>
            </label>
          </div>
        )}
        <p className="muted compact-help">{t('scan.permissionHint')}</p>
        <div className="button-row">
          <button type="button" className="ghost-button" onClick={() => inboundScan()} disabled={loading || !trackingNo.trim()}>{batchMode ? '加入队列' : loading ? t('scan.updating') : t('scan.inbound')}</button>
          {!batchMode && <button type="button" className="ghost-button" onClick={checkShipment} disabled={loading || !trackingNo.trim()}>{t('scan.checkCurrent')}</button>}
        </div>
        {batchMode ? (
          <PendingBatchList items={pendingBatch} onRemove={removePendingBatchItem} />
        ) : shipment ? (
          nextAction ? (
            <div className="next-action-card">
              <span>{t('scan.onlyNextAction')}</span>
              <strong>{t(nextAction.labelKey)}</strong>
              <small>{nextAction.location}</small>
            </div>
          ) : (
            <div className="next-action-card done">
              <strong>{t('scan.noNextAction')}</strong>
            </div>
          )
        ) : (
          <div className="next-action-card pending">
            <strong>{t('scan.checkFirst')}</strong>
            <small>{t('scan.manualFallback')}</small>
          </div>
        )}
        {!batchMode && !actionAllowed && shipment && <p className="warning">{t('errors.invalidTransitionWithNext', { status: t(`status.${shipment.current_status}`), next: getNextActionLabel(t, shipment.current_status) })}</p>}
        {batchMode ? (
          <button className="primary-scan-button" type="button" disabled={loading || pendingBatch.length === 0} onClick={submitPendingBatch}>{loading ? '提交中' : `提交批次（${pendingBatch.length}条）`}</button>
        ) : (
          <button className="primary-scan-button" type="submit" disabled={loading || !canSubmitNextAction}>{loading ? t('scan.updating') : nextAction ? t('scan.submitNext', { action: t(nextAction.labelKey) }) : t('scan.submit')}</button>
        )}
        {batchProgress && <p className={batchProgress.failure ? 'error' : 'notice'}>提交进度：成功 {batchProgress.success} 条，失败 {batchProgress.failure} 条</p>}
        {message && <p className="error" role="alert">{message}</p>}
        {lastError && <button type="button" className="ghost-button" onClick={retryLast}>{t('app.retry')}</button>}
      </form>

      <div>
        {shipment && !batchMode ? (
          <div className="panel scan-result">
            <p className="muted">{t('scan.latestStatus')}</p>
            <h2>{shipment.tracking_no}</h2>
            <p>{shipment.carrier_name || shipment.china_carrier_name || '-'}</p>
            <p>{shipment.hx_no || shipment.platform_tracking_no}</p>
            <p>{t(`status.${shipment.status || shipment.current_status}`)} · {shipment.current_node || shipment.current_location}</p>
            <button onClick={() => navigate(`/shipment/${shipment.tracking_no}`)}>{t('scan.viewDetail')}</button>
          </div>
        ) : (
          <div className="empty">{batchMode ? `待处理队列：${pendingBatch.length} 条` : t('scan.waiting')}</div>
        )}
        <ScanQueue queue={failedQueue} onRetry={retryQueueItem} />
        <RecentScanList scans={recentScans} navigate={navigate} />
      </div>
    </section>
  );
}

function PendingBatchList({ items, onRemove }) {
  return (
    <div className="panel scan-side-list batch-pending-list">
      <h2>待处理队列</h2>
      {!items.length && <div className="empty">暂无待处理运单</div>}
      {items.map((item) => (
        <div className="list-item" key={`${item.tracking_no}-${item.added_at}`}>
          <span>{item.tracking_no}</span>
          <small>{item.status}</small>
          <button type="button" className="ghost-button" onClick={() => onRemove(item.tracking_no)} aria-label={`移除 ${item.tracking_no}`}>X</button>
        </div>
      ))}
    </div>
  );
}

function ScanQueue({ queue, onRetry }) {
  const { t } = useTranslation();
  if (!queue.length) return null;
  return (
    <div className="panel scan-side-list">
      <h2>{t('scan.failedQueue')}</h2>
      {queue.map((item) => (
        <button className="list-item" key={item.createdAt} onClick={() => onRetry(item)}>
          <span>{item.trackingNo}</span>
          <small>{t('app.retry')} · {item.action}</small>
        </button>
      ))}
    </div>
  );
}

function RecentScanList({ scans, navigate }) {
  const { t, i18n } = useTranslation();
  if (!scans.length) return null;
  return (
    <div className="panel scan-side-list">
      <h2>{t('scan.recentScans')}</h2>
      {scans.map((item) => (
        <button className="list-item" key={`${item.tracking_no}-${item.time}`} onClick={() => navigate(`/shipment/${item.tracking_no}`)}>
          <span>{item.tracking_no}</span>
          <small>{t(`status.${item.status}`)} · {item.location} · {formatTime(item.time, i18n.language)}</small>
        </button>
      ))}
    </div>
  );
}
