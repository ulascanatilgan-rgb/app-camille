// ECL Voice Only: OpenAI Realtime WebRTC. No Anam session, media or SDK.
export async function createVoiceOnlySession({
  persona, targetLanguage, topic, difficulty, inputMode, context,
  onStatus, onAssistantDelta, onAssistantDone, onUserText, onSpeech,
  onError, onClosed
}) {
  let peer = null;
  let channel = null;
  let micStream = null;
  let remoteAudio = null;
  let closed = false;
  let sessionReady = false;
  const responseTexts = new Map();
  const sentAt = Date.now();
  const notify = (fn,...args) => { if (!closed) fn?.(...args); };
  const send = event => {
    if (closed || channel?.readyState !== 'open') return false;
    channel.send(JSON.stringify(event));
    return true;
  };
  function sendText(text) {
    const clean = String(text || '').trim();
    if (!clean || !sessionReady) return false;
    const created = send({
      type: 'conversation.item.create',
      item: { type:'message', role:'user', content:[{type:'input_text', text:clean}] }
    });
    return created && send({type:'response.create'});
  }
  function setMuted(muted) {
    micStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
  }
  function handleEvent(message) {
    if (closed) return;
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    const type=event?.type;
    if (type === 'error') {
      notify(onError, event.error?.message || 'Realtime voice error');
      return;
    }
    if (type === 'session.created' || type === 'session.updated') {
      sessionReady = true;
      notify(onStatus,'Voice connected');
    }
    if (type === 'input_audio_buffer.speech_started') notify(onSpeech,true);
    if (type === 'input_audio_buffer.speech_stopped') notify(onSpeech,false);
    if (type === 'conversation.item.input_audio_transcription.completed' ||
        type === 'conversation.item.input_audio_transcription.delta') {
      if(type.endsWith('.completed')){
        const transcript=String(event.transcript || '').trim();
        if(transcript) notify(onUserText,transcript,event.item_id);
      }
    }
    if (type === 'response.output_audio_transcript.delta' ||
        type === 'response.audio_transcript.delta') {
      const id=event.item_id || event.response_id || 'latest';
      const next=(responseTexts.get(id)||'')+String(event.delta||'');
      responseTexts.set(id,next);
      notify(onAssistantDelta,next,id);
    }
    if (type === 'response.output_audio_transcript.done' ||
        type === 'response.audio_transcript.done') {
      const id=event.item_id || event.response_id || 'latest';
      const finalText=String(event.transcript || responseTexts.get(id) || '').trim();
      responseTexts.delete(id);
      if(finalText)notify(onAssistantDone,finalText,id);
    }
    if(type==='response.done')notify(onSpeech,false);
  }
  async function close() {
    if (closed) return;
    closed = true;
    try {if(channel?.readyState==='open')channel.send(JSON.stringify({type:'session.close'}));}catch{}
    try{channel?.close();}catch{}
    try{peer?.close();}catch{}
    micStream?.getTracks().forEach(track=>track.stop());
    if(remoteAudio){remoteAudio.pause();remoteAudio.srcObject=null;remoteAudio.remove();}
    onClosed?.();
  }
  try {
    notify(onStatus,'Connecting OpenAI voice…');
    peer = new RTCPeerConnection();
    remoteAudio=document.createElement('audio');
    remoteAudio.autoplay=true;
    remoteAudio.playsInline=true;
    remoteAudio.setAttribute('aria-hidden','true');
    remoteAudio.style.display='none';
    document.body.appendChild(remoteAudio);
    peer.ontrack=ev => {
      if(closed)return;
      remoteAudio.srcObject=ev.streams[0];
      remoteAudio.play().catch(()=>notify(onStatus,'Tap Start to enable audio'));
    };
    micStream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
    if(closed)throw new Error('Session closed');
    for(const track of micStream.getAudioTracks())peer.addTrack(track,micStream);
    setMuted(inputMode !== 'speak');
    channel=peer.createDataChannel('oai-events');
    channel.addEventListener('message',handleEvent);
    channel.addEventListener('open',()=>{
      sessionReady=true;
      notify(onStatus,'Voice connected');
      // Model begins the speaking lesson itself; no microphone input required.
      send({type:'response.create',response:{
        instructions:context
          ? 'Continue the preceding conversation in the selected language and current theme. Ask one short practical follow-up question. Do not restart from scratch.'
          : 'Start the selected ECL theme lesson now. Say only one short natural greeting or practical question in the selected language, then invite the learner to answer. Keep it concise.'
      }});
    });
    channel.addEventListener('close',()=>{if(!closed)notify(onClosed);});
    peer.addEventListener('connectionstatechange',()=>{
      if(!closed&&['failed','closed'].includes(peer.connectionState))
        notify(onError,'Realtime voice connection lost');
    });
    const offer=await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answer=await fetch('/ecl-realtime-call',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sdp:peer.localDescription?.sdp || offer.sdp,
        persona,targetLanguage,topic,difficulty,
        inputMode,context
      })
    });
    const sdp=await answer.text();
    if(!answer.ok) {
      let msg=sdp;
      try{msg=JSON.parse(sdp).error||msg;}catch{}
      throw new Error(String(msg).slice(0,260));
    }
    if(!sdp.startsWith('v=0'))throw new Error('OpenAI did not return a valid WebRTC answer');
    if(closed)throw new Error('Session closed');
    await peer.setRemoteDescription({type:'answer',sdp});
    // Do not display "Live" before the authenticated OpenAI channel is ready.
    await new Promise((resolve,reject)=>{
      if(channel.readyState==='open')return resolve();
      const timeout=setTimeout(()=>reject(new Error('OpenAI voice channel timed out')),12000);
      channel.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
      channel.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('OpenAI voice channel failed'));},{once:true});
    });
    return {sendText,setMuted,close,isReady:()=>sessionReady,startedAt:sentAt};
  } catch(error){
    await close();
    throw error;
  }
}
