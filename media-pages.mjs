// Independent ECL Song (draft-only) and Clips (Anam capture) learning libraries.
import { createClient } from '@anam-ai/js-sdk';
const $=id=>document.getElementById(id);
const NAMES={emma:'Emma',charlotte:'Charlotte',louis:'Louis'};
const THEMES=['Daily life','Work','Travel','Friends','Food','Technology'];
const storage=(name,lang)=>'ecl.media.'+name+'.v1.'+lang;
const read=(name,lang,fallback=[])=>{try{return JSON.parse(localStorage.getItem(storage(name,lang))||'null')??fallback}catch{return fallback}};
const write=(name,lang,data)=>{try{localStorage.setItem(storage(name,lang),JSON.stringify(data));return true}catch{return false}};
const dbOpen=()=>new Promise((resolve,reject)=>{
  const r=indexedDB.open('ecl-video-library-v1',1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('clips'))r.result.createObjectStore('clips',{keyPath:'id'})};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
async function withStore(mode,work){
  const db=await dbOpen();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('clips',mode),os=tx.objectStore('clips');
    const req=work(os);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  })}finally{db.close()}
}
const allClips=()=>withStore('readonly',os=>os.getAll());
const putClip=clip=>withStore('readwrite',os=>os.put(clip));
const removeClip=id=>withStore('readwrite',os=>os.delete(id));
const safeWords=(getWords,lang)=>{
  const talk=getWords().filter(w=>w?.nl&&w?.en&&(!w.language||w.language===lang)).map(w=>({word:String(w.nl),english:String(w.en)}));
  const extra=read('news.words',lang,[]); // compatibility with existing news vocabulary key below
  const old=(()=>{try{return JSON.parse(localStorage.getItem('ecl.news.words.v1.'+lang)||'[]')}catch{return []}})();
  const seen=new Set();
  return [...talk,...extra,...old.map(w=>({word:String(w.word||''),english:String(w.english||'')}))]
    .filter(w=>{const k=w.word.trim().toLocaleLowerCase();if(!k||!w.english||seen.has(k))return false;seen.add(k);return true}).slice(-200);
};
function makeOption(select,values){select.replaceChildren();for(const [value,label] of values){const op=document.createElement('option');op.value=value;op.textContent=label;select.append(op)}}
function renderTokens(target,text,dict,active,onClick){
  target.replaceChildren();
  const tokens=String(text||'').split(/(\s+)/);
  let index=0;
  for(const token of tokens){
    if(!token)continue;
    if(/^\s+$/.test(token)){target.append(document.createTextNode(token));continue}
    const raw=token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLocaleLowerCase();
    const meaning=dict.get(raw);
    const b=document.createElement('button');b.type='button';b.className='media-word';
    b.textContent=token;b.dataset.index=String(index++);
    if(b.dataset.index===String(active))b.classList.add('media-speaking');
    if(meaning)b.title='English: '+meaning;
    b.addEventListener('click',()=>onClick(token,meaning||''));
    target.append(b);
  }
}
export function initMediaPages({getLanguage,getTalkWords}){
  let current='talk',client=null,recorder=null,clock=null,liveSince=0,stopInProgress=false;
  let activeClip=null,clipUrl='',liveSequence=0,saving=false,abortWait=null;
  const status=(id,msg)=>{const el=$(id);if(el)el.textContent=msg};
  const langName=()=>({nl:'Dutch',fr:'French',en:'English'}[getLanguage()]||'Dutch');
  const dictionary=()=>new Map(safeWords(getTalkWords,getLanguage()).map(w=>[w.word.toLocaleLowerCase(),w.english]));
  const sourceWords=count=>{
    const words=safeWords(getTalkWords,getLanguage());
    return words.slice(-count).reverse();
  };
  function showInventory(){
    const words=sourceWords(20);
    status('songWordsInfo',words.length+' saved '+langName()+' words available · '+Math.min(words.length,20)+' used for drafts');
    status('clipWordsInfo',words.length+' saved '+langName()+' words available · up to 12 per video');
  }
  const asDate=stamp=>{try{return new Date(stamp).toLocaleDateString()}catch{return ''}};
  function songCollection(){return read('songs',getLanguage(),[])}
  function showSong(song){
    const view=$('songDraft');view.hidden=!song;if(!song)return;
    status('songDraftTitle',song.title);
    status('songLyrics',song.text);
    status('songDraftMeta',song.genre+' · '+song.theme+' · '+asDate(song.createdAt));
    status('songDraftNote','Lyrics saved. Music generation and synced playback will be enabled after ElevenLabs is connected.');
    renderTokens($('songWordsUsed'),song.usedWords.map(w=>w.word).join(' · '),dictionary(),-1,(word,meaning)=>{
      status('songWordMeaning',word+' — '+(meaning||'Saved vocabulary'));
    });
  }
  function renderSongs(){
    const list=$('songLibrary');list.replaceChildren();
    const songs=songCollection();
    status('songLibraryCount',songs.length+' drafts');
    if(!songs.length){list.textContent='No lyrics yet. Create a draft using your saved words.';showSong(null);return}
    for(const song of songs){
      const b=document.createElement('button');b.className='media-library-item';b.type='button';
      const title=document.createElement('strong');title.textContent=song.title;
      const meta=document.createElement('small');meta.textContent=song.genre+' · '+asDate(song.createdAt)+' · Lyrics';
      b.append(title,meta);b.addEventListener('click',()=>showSong(song));list.append(b);
    }
    showSong(songs[0]);
  }
  async function makeSong(){
    const lang=getLanguage(),words=sourceWords(20);
    if(!words.length){status('songStatus','Save vocabulary from Talk first.');return}
    const btn=$('songRunButton');btn.disabled=true;
    status('songStatus','Writing original lyrics…');
    try{
      const request=await fetch('/study-media-script',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:'song',language:lang,words,theme:$('songTheme').value,genre:$('songGenre').value})});
      const data=await request.json();
      if(!request.ok)throw new Error(data.error||'Could not create lyrics');
      if(lang!==getLanguage())return;
      const song={...data,id:'song-'+Date.now(),createdAt:new Date().toISOString(),theme:$('songTheme').value,genre:$('songGenre').value};
      if(!write('songs',lang,[song,...songCollection()].slice(0,100)))throw new Error('Local storage is full');
      renderSongs();status('songStatus','Lyrics saved to your Song library. Music production is not connected yet.');
    }catch(e){status('songStatus',e.message||'Lyrics unavailable')}
    finally{btn.disabled=false}
  }
  function mime(){
    if(!window.MediaRecorder)return '';
    return ['video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
      .find(v=>MediaRecorder.isTypeSupported(v))||'';
  }
  function cleanClipVideo(){
    if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}
    $('clipSavedVideo').pause();$('clipSavedVideo').removeAttribute('src');
    $('clipSavedVideo').load();
  }
  function showClipWord(word,english){
    $('clipSavedVideo').pause();
    status('clipWordDetail',word+' — '+(english||'Not in saved vocabulary'));
  }
  function updateSubtitles(){
    if(!activeClip)return;
    const video=$('clipSavedVideo');
    const all=activeClip.text.split(/\s+/).filter(Boolean);
    const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:(activeClip.duration||60);
    const index=Math.min(all.length-1,Math.max(0,Math.floor((video.currentTime/Math.max(.1,duration)) * all.length)));
    const start=Math.max(0,Math.floor(index/11)*11),end=Math.min(all.length,start+11);
    const strip=t=>t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLocaleLowerCase();
    const dict=dictionary();const box=$('clipSubtitles');box.replaceChildren();
    for(let i=start;i<end;i++){
      if(i>start)box.append(document.createTextNode(' '));
      const word=all[i],b=document.createElement('button');
      b.type='button';b.textContent=word;b.className='media-subtitle-word'+(i===index?' media-speaking':'');
      b.addEventListener('click',()=>showClipWord(word,dict.get(strip(word))));
      box.append(b);
    }
    const transcript=$('clipTranscript');
    const prev=transcript.querySelector('.media-speaking');
    if(prev)prev.classList.remove('media-speaking');
    const active=transcript.querySelector('[data-index="'+index+'"]');
    if(active)active.classList.add('media-speaking');
  }
  async function selectClip(clip){
    cleanClipVideo();
    activeClip=clip;
    $('clipPlayback').hidden=false;
    status('clipPlaybackTitle',clip.title+' · '+(NAMES[clip.persona]||'Emma'));
    status('clipPlaybackMeta',asDate(clip.createdAt)+' · '+clip.language.toUpperCase()+' · saved on this device');
    clipUrl=URL.createObjectURL(clip.blob);
    $('clipSavedVideo').src=clipUrl;
    status('clipWordDetail','Tap any word to pause and see its English meaning.');
    renderTokens($('clipTranscript'),clip.text,dictionary(),-1,showClipWord);
    updateSubtitles();
    $('clipDownloadButton').onclick=()=>{
      const a=document.createElement('a');a.href=clipUrl;
      a.download='ecl-'+clip.persona+'-'+clip.createdAt.slice(0,10)+(clip.blob.type.includes('mp4')?'.mp4':'.webm');
      a.click();
    };
  }
  async function renderClips(){
    const lang=getLanguage(),list=$('clipLibrary');list.replaceChildren();
    const clips=(await allClips()).filter(c=>c.language===lang)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    status('clipLibraryCount',clips.length+' saved clips');
    if(!clips.length){
      list.textContent='Your saved Anam videos will appear here. Replay does not open a new session.';
      $('clipPlayback').hidden=true;activeClip=null;cleanClipVideo();return;
    }
    for(const clip of clips){
      const row=document.createElement('div');row.className='media-library-row';
      const b=document.createElement('button');b.type='button';b.className='media-library-item';
      const title=document.createElement('strong');title.textContent=clip.title;
      const meta=document.createElement('small');meta.textContent=(NAMES[clip.persona]||'Avatar')+' · '+asDate(clip.createdAt)+' · '+Math.round(clip.duration||60)+'s';
      b.append(title,meta);b.addEventListener('click',()=>selectClip(clip));
      const del=document.createElement('button');del.type='button';del.className='media-delete';del.textContent='Delete';
      del.setAttribute('aria-label','Delete '+clip.title);
      del.addEventListener('click',async()=>{if(!confirm('Delete this saved video?'))return;await removeClip(clip.id);await renderClips()});
      row.append(b,del);list.append(row);
    }
    if(!activeClip||activeClip.language!==lang||!clips.some(x=>x.id===activeClip.id))await selectClip(clips[0]);
  }
  function stopStream(){
    const previous=client;client=null;
    if(previous)Promise.resolve(previous.stopStreaming()).catch(()=>{});
    $('clipLiveVideo').srcObject=null;$('clipLivePanel').hidden=true;
  }
  async function finishRecording(completed){
    if(stopInProgress)return;
    stopInProgress=true;clearInterval(clock);clock=null;
    const r=recorder;recorder=null;
    if(r&&r.state!=='inactive'){
      const stopped=new Promise(resolve=>{r.addEventListener('stop',resolve,{once:true})});
      r.stop();await stopped;
    }
    stopStream();
    $('clipRunButton').disabled=false;$('clipCancelButton').hidden=true;
    stopInProgress=false;
    if(!completed)status('clipStatus','Recording stopped. Incomplete clips are not saved.');
  }
  async function cancelClip(){
    liveSequence++;
    if(abortWait){const abort=abortWait;abortWait=null;abort();}
    if(!recorder){stopStream();return}
    saving=false;await finishRecording(false);
  }
  async function runClip(){
    if(saving)return;
    const words=sourceWords(12),lang=getLanguage(),persona=$('clipPersona').value;
    if(!words.length){status('clipStatus','Save vocabulary from Talk first.');return}
    if(!mime()){status('clipStatus','This browser cannot record avatar video. Try an updated Safari or Chrome.');return}
    saving=true;let seq=++liveSequence,recorded=[];
    $('clipRunButton').disabled=true;$('clipCancelButton').hidden=false;
    status('clipStatus','Preparing a 1-minute '+(NAMES[persona]||'Emma')+' script…');
    try{
      const response=await fetch('/study-media-script',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:'clip',language:lang,words,theme:$('clipTheme').value})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not prepare clip');
      if(seq!==liveSequence||lang!==getLanguage())return;
      status('clipScript',data.text);
      status('clipStatus','Connecting '+NAMES[persona]+' on Anam…');
      const tokenResp=await fetch('/anam-session',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({persona,targetLanguage:lang,topic:'open'})});
      const token=await tokenResp.json();
      if(!tokenResp.ok||!token.sessionToken)throw new Error(token.error||'Anam connection unavailable');
      if(seq!==liveSequence||lang!==getLanguage())return;
      client=createClient(token.sessionToken,{disableInputAudio:true});
      $('clipLivePanel').hidden=false;
      await client.streamToVideoElement('clipLiveVideo');
      if(seq!==liveSequence||lang!==getLanguage()){stopStream();return}
      const video=$('clipLiveVideo'),media=video.srcObject;
      if(!(media instanceof MediaStream))throw new Error('Anam did not provide a recordable video stream.');
      const audioTracks=media.getAudioTracks(),videoTracks=media.getVideoTracks();
      if(!audioTracks.length||!videoTracks.length)
        throw new Error('This Anam session does not expose both audio and video tracks for saving. No clip was stored.');
      const combined=new MediaStream([...videoTracks,...audioTracks]);
      const type=mime(),r=new MediaRecorder(combined,{mimeType:type});
      recorder=r;
      r.addEventListener('dataavailable',e=>{if(e.data.size)recorded.push(e.data)});
      const script=data.text,wordCount=script.split(/\s+/).length;
      const targetMs=Math.max(54000,Math.min(80000,wordCount*570+3500));
      liveSince=Date.now();
      r.start(1000);
      status('clipStatus','Recording '+NAMES[persona]+' speaking… about 1 minute.');
      const stream=client.createTalkMessageStream();
      await stream.streamMessageChunk(script,true);
      await new Promise((resolve,reject)=>{
        abortWait=()=>{clearInterval(clock);clock=null;reject(new Error('Clip cancelled'));};
        clock=setInterval(()=>{
          if(seq!==liveSequence){const abort=abortWait;abortWait=null;if(abort)abort();return}
          const elapsed=Date.now()-liveSince;
          status('clipStatus','Recording · '+Math.min(100,Math.round(elapsed/targetMs*100))+'%');
          if(elapsed>=targetMs){clearInterval(clock);clock=null;abortWait=null;resolve()}
        },300);
      });
      if(seq!==liveSequence)return;
      saving=false;
      await finishRecording(true);
      if(!recorded.length)throw new Error('No recorded video data was received.');
      const blob=new Blob(recorded,{type:r.mimeType||type});
      if(blob.size<10000)throw new Error('The recording was incomplete. Please retry.');
      const clip={id:'clip-'+Date.now(),createdAt:new Date().toISOString(),
        language:lang,persona,title:data.title,text:script,theme:data.theme,
        usedWords:data.usedWords,blob,duration:(Date.now()-liveSince)/1000};
      await putClip(clip);
      status('clipStatus','Saved! Replay this video any time without starting Anam again.');
      await renderClips();await selectClip(clip);
    }catch(e){
      console.warn('Clip creation failed',e);
      status('clipStatus',String(e.message||'Could not save clip.'));
      if(recorder)await finishRecording(false);else stopStream();
    }finally{
      saving=false;abortWait=null;recorded=[];$('clipRunButton').disabled=false;$('clipCancelButton').hidden=true;
    }
  }
  makeOption($('songTheme'),THEMES.map(x=>[x,x]));
  makeOption($('clipTheme'),THEMES.map(x=>[x,x]));
  makeOption($('songGenre'),['Pop','Acoustic','Indie','Hip-hop','Jazz','Electronic','Ballad'].map(x=>[x,x]));
  makeOption($('clipPersona'),Object.entries(NAMES));
  $('clipPersona').value=localStorage.getItem('ecl.selectedPersona.v1')||'emma';
  $('songRunButton').addEventListener('click',makeSong);
  $('clipRunButton').addEventListener('click',runClip);
  $('clipCancelButton').addEventListener('click',cancelClip);
  $('clipSavedVideo').addEventListener('timeupdate',updateSubtitles);
  $('clipSavedVideo').addEventListener('loadedmetadata',updateSubtitles);
  $('clipSavedVideo').addEventListener('seeked',updateSubtitles);
  window.addEventListener('pagehide',()=>{void cancelClip();cleanClipVideo()});
  function onPage(next){
    if(current==='clips'&&next!=='clips')void cancelClip();
    current=next;
    if(next==='song'){showInventory();renderSongs()}
    if(next==='clips'){showInventory();void renderClips()}
  }
  function refreshLanguage(){
    if(current==='clips')void cancelClip();
    if(current==='song'){showInventory();renderSongs()}
    if(current==='clips'){showInventory();activeClip=null;void renderClips()}
  }
  return {onPage,refreshLanguage,stop:cancelClip};
}
