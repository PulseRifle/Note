/* Voice recording runs independently of the note editor and page navigation. */
(() => {
    const button = document.getElementById('audioRecordBtn');
    const status = document.getElementById('audioRecordStatus');
    button.title = 'M4A 음성 녹음';
    const list = document.getElementById('recordingList');
    const recordings = new Map();
    let state = 'idle', recorder = null, stream = null, timer = null;
    let startedAt = 0, urls = [], dbPromise;
    function audioDatabase() {
        if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('smart-ai-note-audio', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('recordings', {keyPath: 'id'});
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('녹음 저장소를 다른 탭에서 사용 중입니다.'));
        });
        return dbPromise;
    }
    async function saveAudio(recording) {
        const db = await audioDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('recordings', 'readwrite');
            transaction.objectStore('recordings').put(recording);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    function extension(type) { return type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'; }
    function renderRecordings() {
        urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
        list.replaceChildren();
        document.getElementById('recordingCount').textContent = recordings.size;
        for (const recording of [...recordings.values()].sort((a,b) => b.createdAt-a.createdAt)) {
            const entry = document.createElement('div'); entry.className = 'audio-entry';
            const label = document.createElement('span');
            label.textContent = new Date(recording.createdAt).toLocaleString('ko-KR');
            const url = URL.createObjectURL(recording.blob); urls.push(url);
            const player = document.createElement('audio'); player.controls = true; player.preload = 'metadata'; player.src = url;
            player.setAttribute('aria-label', `${label.textContent} 녹음 재생`);
            const download = document.createElement('a'); download.href = url;
            download.download = `녹음-${new Date(recording.createdAt).toISOString().replace(/[:.]/g,'-')}.${extension(recording.blob.type)}`;
            download.textContent = `↓ ${extension(recording.blob.type).toUpperCase()} 다운로드`;
            entry.append(label, player, download);
            if (!recording.persisted) {
                const warning = document.createElement('span'); warning.textContent = '저장되지 않음 · 페이지를 닫기 전에 다운로드해주세요.';
                entry.append(warning);
            }
            list.append(entry);
        }
        if (!recordings.size) list.textContent = '녹음 내역이 없습니다.';
    }
    function releaseMicrophone() {
        stream?.getTracks().forEach(track => track.stop()); stream = null;
        clearInterval(timer); timer = null;
    }
    function idle(message) {
        state = 'idle'; document.body.classList.remove('audio-recording'); button.disabled = false;
        button.setAttribute('aria-pressed','false'); button.textContent = '🎙️ 녹음'; status.textContent = message;
    }
    function stopAudio() {
        if (state !== 'recording' || recorder?.state === 'inactive') return;
        state = 'saving'; button.disabled = true; button.textContent = '저장 중…';
        recorder.stop(); clearInterval(timer);
    }
    button.addEventListener('click', async () => {
        if (state === 'recording') { stopAudio(); return; }
        if (state !== 'idle') return;
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            status.textContent = '이 브라우저는 녹음을 지원하지 않습니다. HTTPS 환경에서 지원 브라우저를 사용해주세요.';
            return;
        }
        // M4A is an audio-only MP4 container. Prefer AAC where available;
        // never disguise WebM data by changing its filename extension.
        const mimeType = ['audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        if (!mimeType) {
            status.textContent = '이 브라우저는 M4A 녹음을 지원하지 않습니다. 최신 Safari 등 M4A 녹음을 지원하는 브라우저를 사용해주세요.';
            return;
        }
        state = 'requesting'; button.disabled = true; status.textContent = '마이크 권한을 요청하고 있습니다…';
        try {
            stream = await navigator.mediaDevices.getUserMedia({audio: true});
            recorder = new MediaRecorder(stream, {mimeType});
            const chunks = []; startedAt = Date.now(); const createdAt = startedAt;
            const recordingMime = recorder.mimeType || mimeType;
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            recorder.onerror = () => {
                status.textContent = '녹음이 중단되었습니다. 수집한 음성을 저장합니다.';
                if (recorder.state !== 'inactive') stopAudio();
            };
            recorder.onstop = async () => {
                releaseMicrophone(); state = 'saving'; button.disabled = true;
                const blob = new Blob(chunks, {type: recordingMime});
                if (!blob.size) { idle('녹음된 음성이 없습니다. 마이크를 확인해주세요.'); return; }
                const recording = {id: crypto.randomUUID(), createdAt, blob};
                recordings.set(recording.id, {...recording, persisted: false}); renderRecordings();
                try {
                    await saveAudio(recording);
                    recordings.get(recording.id).persisted = true;
                    idle('M4A 녹음을 저장했습니다. 녹음 내역에서 재생할 수 있습니다.');
                } catch {
                    idle('녹음 저장에 실패했습니다. 녹음 내역에서 파일을 다운로드해주세요.');
                }
                renderRecordings(); document.getElementById('recordingsPanel').open = true;
            };
            recorder.start(1000); state = 'recording'; document.body.classList.add('audio-recording'); button.disabled = false;
            button.setAttribute('aria-pressed','true'); button.textContent = '⏹ 녹음 중지';
            const updateTime = () => {
                const seconds = Math.floor((Date.now()-startedAt)/1000);
                status.textContent = `● ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
            };
            updateTime(); timer = setInterval(updateTime,1000);
            for (const track of stream.getAudioTracks()) track.addEventListener('ended', stopAudio);
        } catch (error) {
            releaseMicrophone(); idle(error.name === 'NotAllowedError' ? '마이크 권한을 허용해야 녹음할 수 있습니다.' : '녹음을 시작할 수 없습니다. 마이크 사용 상태를 확인해주세요.');
        }
    });
    window.hasPendingAudio = () => state !== 'idle' || [...recordings.values()].some(recording => !recording.persisted);
    (async () => {
        try {
            const db = await audioDatabase();
            const saved = await new Promise((resolve,reject) => {
                const request = db.transaction('recordings','readonly').objectStore('recordings').getAll();
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            saved.forEach(recording => { if(!recordings.has(recording.id)) recordings.set(recording.id,{...recording,persisted:true}); });
        } catch {
            status.textContent = '녹음 보관함을 사용할 수 없습니다. 녹음 후 파일로 다운로드해주세요.';
        }
        renderRecordings();
    })();
})();
