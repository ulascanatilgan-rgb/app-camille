// Independent ECL Song (draft-only) and Clips (Anam capture) learning libraries.
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import {clipTokens,clipSentences} from './clip-alignment.mjs';
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
const getClip=id=>withStore('readonly',os=>os.get(id));
const putClip=clip=>withStore('readwrite',os=>os.put(clip));
const removeClip=id=>withStore('readwrite',os=>os.delete(id));
const wordKey=w=>String(w||'').normalize('NFKC').trim().toLocaleLowerCase();
const safeWords=(getWords,lang)=>{
  const talk=(getWords()||[]).filter(w=>w?.nl&&w?.en&&(!w.language||w.language===lang))
    .map(w=>({word:String(w.nl).trim(),english:String(w.en).trim(),source:'Talk'}));
  const news=(()=>{try{return JSON.parse(localStorage.getItem('ecl.news.words.v1.'+lang)||'[]')}catch{return []}})();
  const older=read('news.words',lang,[]);
  const candidates=[...talk,...[...older,...news].map(w=>({
    word:String(w.word||'').trim(),english:String(w.english||'').trim(),source:'Articles'
  }))];
  const seen=new Set();
  return candidates.filter(w=>{
    const k=wordKey(w.word);
    if(!k||!w.english||seen.has(k))return false;
    seen.add(k);return true;
  });
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
  let captionRequestId=0,captionFrame=0,captionSentenceIndex=-1,captionWordIndex=-2;
  const captionPending=new Map();
  let selectedClipWords=[],clipDraft=null,preparingClip=false,prepareSequence=0;
  let clipView='clips',clipsRenderSequence=0;
  const status=(id,msg)=>{const el=$(id);if(el)el.textContent=msg};
  const langName=()=>({nl:'Dutch',fr:'French',en:'English'}[getLanguage()]||'Dutch');
  function setClipView(view){
    if(saving&&view!==clipView){
      status('clipStatus','Stop recording before leaving New.');
      return;
    }
    clipView=view==='new'?'new':'clips';
    $('clipsPage').querySelector('.clip-media-grid').dataset.view=clipView;
    $('clipNewPanel').hidden=clipView!=='new';
    $('clipLibraryPanel').hidden=clipView!=='clips';
    $('clipVideosTab').classList.toggle('selected',clipView==='clips');
    $('clipNewTab').classList.toggle('selected',clipView==='new');
    $('clipVideosTab').setAttribute('aria-selected',String(clipView==='clips'));
    $('clipNewTab').setAttribute('aria-selected',String(clipView==='new'));
    if(clipView==='clips')void renderClips();
    else restoreClipWorkspace();
  }
  const dictionary=(language=getLanguage())=>{
    const words=language===getLanguage()?getTalkWords():(()=>{
      try{return JSON.parse(localStorage.getItem('camille.words.v3.'+language)||'[]')}
      catch{return []}
    })();
    return new Map(safeWords(()=>words,language)
      .map(w=>[w.word.toLocaleLowerCase(),w.english]));
  };
  const sourceWords=count=>{
    const words=safeWords(getTalkWords,getLanguage());
    return words.slice(-count).reverse();
  };
  function showInventory(){
    const words=sourceWords(20),universe=safeWords(getTalkWords,getLanguage());
    status('songWordsInfo',words.length+' saved '+langName()+' words available · '+Math.min(words.length,20)+' used for drafts');
    status('clipWordsInfo',universe.length+' learned '+langName()+' words from Talk + Articles · Mix to choose up to 20');
    status('clipUniverseCount',universe.length+' words  ⌄');
  }
  function renderClipWordUniverse(){
    const list=$('clipAllWords');list.replaceChildren();
    const search=wordKey($('clipWordsSearch').value);
    const words=safeWords(getTalkWords,getLanguage()).sort((a,b)=>a.word.localeCompare(b.word,getLanguage()));
    const filtered=words.filter(w=>!search||wordKey(w.word).includes(search)||wordKey(w.english).includes(search));
    if(!filtered.length){
      const empty=document.createElement('p');empty.className='media-hint';
      empty.textContent=words.length?'No matching words.':'No saved words yet. Learn words in Talk or Articles.';
      list.append(empty);return;
    }
    const fragment=document.createDocumentFragment();
    for(const w of filtered){
      const row=document.createElement('div');row.className='clip-universe-row';
      const name=document.createElement('strong');name.textContent=w.word;
      const meaning=document.createElement('span');meaning.textContent=w.english;
      const from=document.createElement('small');from.textContent=w.source;
      row.append(name,meaning,from);fragment.append(row);
    }
    list.append(fragment);
  }
  function renderClipSelection(){
    const chosen=$('clipSelectedWords');chosen.replaceChildren();
    const universe=safeWords(getTalkWords,getLanguage());
    status('clipSelectionInfo',selectedClipWords.length
      ?selectedClipWords.length+' selected of '+universe.length+' learned words · Press Mix for a different set'
      :'Press Mix to select up to 20 random words from Talk and Articles.');
    const fragment=document.createDocumentFragment();
    for(const [i,w] of selectedClipWords.entries()){
      const item=document.createElement('span');item.className='clip-selected-chip';
      const number=document.createElement('small');number.textContent=String(i+1);
      const label=document.createElement('strong');label.textContent=w.word;
      item.title=w.english+' · '+(w.source||'Saved');
      item.append(number,label);fragment.append(item);
    }
    chosen.append(fragment);
    $('clipMixButton').disabled=!universe.length||preparingClip||saving;
    $('clipPrepareButton').disabled=!selectedClipWords.length||preparingClip||saving;
    $('clipRunButton').disabled=!clipDraft?.text||clipDraft.language!==getLanguage()||
      clipDraft.languageValidated!==true||clipDraft.validationVersion!==2||
      preparingClip||saving;
    $('clipPrepareButton').textContent=preparingClip?'Preparing…':clipDraft?'Prepare · Another script':'Prepare · Script';
    $('clipPreparedPanel').hidden=!clipDraft?.text;
    if(clipDraft?.text){
      status('clipPreparedTitle',clipDraft.title||'Clip script');
      status('clipPreparedScript',clipDraft.text);
    }
  }
  function restoreClipWorkspace(){
    const lang=getLanguage(),pool=safeWords(getTalkWords,lang);
    const known=new Map(pool.map(w=>[wordKey(w.word),w]));
    selectedClipWords=read('clip.selection',lang,[]).map(w=>
      known.get(wordKey(w.word))||(w?.word&&w?.english?w:null)).filter(Boolean).slice(0,20);
    const draft=read('clip.draft',lang,null);
    const signature=words=>words.map(w=>wordKey(w.word)).join('|');
    // Keep legacy drafts safely in localStorage, but never run a draft
    // that predates the strict server language validation. Prepare again.
    clipDraft=draft?.text&&draft.language===lang&&
      draft.languageValidated===true&&draft.validationVersion===2&&
      signature(draft.selectedWords||[])===signature(selectedClipWords)?draft:null;
    if(clipDraft?.theme&&[...$('clipTheme').options].some(o=>o.value===clipDraft.theme))
      $('clipTheme').value=clipDraft.theme;
    showInventory();renderClipSelection();
    if(draft?.text&&!clipDraft)
      status('clipStatus','Previous draft is not language-verified. Your words are safe. Press Prepare to write a '+langName()+'-only script.');
    if(!$('clipWordsPanel').hidden)renderClipWordUniverse();
  }
  function invalidateClipDraft(){
    clipDraft=null;write('clip.draft',getLanguage(),null);
    renderClipSelection();
  }
  function mixClipWords(){
    if(preparingClip||saving)return;
    const pool=safeWords(getTalkWords,getLanguage());
    if(!pool.length){
      status('clipStatus','Learn words in Talk or News, then return to Clips.');return;
    }
    const old=selectedClipWords.map(w=>wordKey(w.word)).sort().join('|');
    let fresh=[];
    // Shuffle all learned words, not merely the last few. Re-mix when possible.
    for(let attempt=0;attempt<7;attempt++){
      const shuffled=[...pool];
      for(let i=shuffled.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
      }
      fresh=shuffled.slice(0,20);
      if(pool.length<=20||fresh.map(w=>wordKey(w.word)).sort().join('|')!==old)break;
    }
    selectedClipWords=fresh;
    write('clip.selection',getLanguage(),selectedClipWords);
    invalidateClipDraft();
    status('clipStatus',fresh.length+' words selected. Press Prepare to write a 1-minute script.');
  }
  async function prepareClipScript(){
    if(preparingClip||saving||!selectedClipWords.length)return;
    const lang=getLanguage(),theme=$('clipTheme').value,words=selectedClipWords.map(w=>({...w}));
    const seq=++prepareSequence;
    preparingClip=true;renderClipSelection();
    status('clipStatus','Writing and checking a '+langName()+'-only script…');
    try{
      const response=await fetch('/study-media-script',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          kind:'clip',language:lang,theme,words,
          previousTitle:clipDraft?.title||'',
          previousText:clipDraft?.text?.slice(0,650)||''
        })
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not prepare the clip script');
      if(lang!==getLanguage()||seq!==prepareSequence)return;
      if(!data.text?.trim())throw new Error('The generated script was empty.');
      if(data.kind!=='clip'||data.language!==lang||
         data.languageValidated!==true||data.validationVersion!==2)
        throw new Error('This script did not pass the selected-language check. Nothing was saved. Press Prepare again.');
      clipDraft={...data,theme,selectedWords:words,preparedAt:new Date().toISOString()};
      if(!write('clip.draft',lang,clipDraft))
        status('clipStatus','Script ready, but your browser could not save the draft locally.');
      else status('clipStatus','Script ready. Read it below, press Prepare to try another, or Run to record.');
    }catch(error){
      if(seq===prepareSequence&&lang===getLanguage())
        status('clipStatus',error.message||'Could not prepare script. Try Prepare again.');
    }finally{
      if(seq===prepareSequence){preparingClip=false;renderClipSelection();}
    }
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
    if(captionFrame){cancelAnimationFrame(captionFrame);captionFrame=0;}
    const video=$('clipSavedVideo');
    video.pause();video.removeAttribute('src');video.load();
    if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}
    $('clipPlayButton').hidden=false;
    captionSentenceIndex=-1;captionWordIndex=-2;
    $('clipSubtitles').replaceChildren();
    $('clipEnglishSubtitles').replaceChildren();
  }
  function showClipPlaybackMessage(message,{error=false}={}){
    const messageEl=$('clipPlaybackStatus');
    messageEl.textContent=error?message:'';
    messageEl.hidden=!error;
  }
  function playSavedClip(){
    const video=$('clipSavedVideo');
    if(!activeClip?.blob?.size){
      showClipPlaybackMessage('This saved recording is missing its video file.',{error:true});
      return;
    }
    // Keep play() directly inside the tap handler for iOS user activation.
    if(video.ended||video.currentTime>=video.duration-.12){
      try{video.currentTime=0}catch{}
    }
    showClipPlaybackMessage('');
    try{
      const started=video.play();
      if(started&&typeof started.then==='function')
        started.then(()=>{
          $('clipPlayButton').hidden=true;
          showClipPlaybackMessage('');
        }).catch(error=>{
          $('clipPlayButton').hidden=false;
          showClipPlaybackMessage('Playback unavailable: '+String(error?.message||'Unsupported video format')+
            '. Try the Download video option.',{error:true});
        });
    }catch(error){
      $('clipPlayButton').hidden=false;
      showClipPlaybackMessage('Cannot play this recording: '+String(error?.message||error)+
        '. Use Download video to open it in a compatible player.',{error:true});
    }
  }
  function showClipWord(word,english){
    $('clipSavedVideo').pause();
    status('clipWordDetail',word+' — '+(english||'Not in saved vocabulary'));
  }
  // Display actual recorded-speech timestamps; never claim a proportional
  // script-duration approximation is synchronized with Anam's voice.
  function activeClipIndex(time){
    const words=activeClip?.wordTimes;
    if(!activeClip?.aligned||!Array.isArray(words)||!words.length||time<words[0].start)return -1;
    let low=0,high=words.length-1;
    while(low<=high){
      const mid=(low+high)>>1;
      if(words[mid].start<=time)low=mid+1;else high=mid-1;
    }
    const index=Math.max(0,high);
    return time<=words[index].end+.16?index:-1;
  }
  function subtitleSentenceAt(time,wordIndex){
    const clip=activeClip;
    const sentences=clip?.captionSentences?.length?clip.captionSentences:clipSentences(clip?.text||'');
    if(!sentences.length)return {index:-1,sentence:null};
    let tokenIndex=wordIndex;
    if(tokenIndex<0&&clip?.aligned&&Array.isArray(clip.wordTimes)){
      let lo=0,hi=clip.wordTimes.length-1;
      while(lo<=hi){
        const mid=(lo+hi)>>1;
        if(clip.wordTimes[mid].start<=time)lo=mid+1;else hi=mid-1;
      }
      tokenIndex=Math.max(0,hi);
    }
    if(tokenIndex<0){
      // While a legacy recording awaits speech alignment, advance WHOLE
      // bilingual sentences with video time. Do not fake word highlights.
      const video=$('clipSavedVideo');
      const duration=Number.isFinite(video.duration)&&video.duration>0?
        video.duration:(clip.duration||60);
      const progress=Math.min(.999,Math.max(0,time/Math.max(.1,duration)));
      const tokenTotal=clipTokens(clip.text).length;
      tokenIndex=Math.min(Math.max(0,tokenTotal-1),Math.floor(progress*tokenTotal));
    }
    const found=sentences.findIndex(item=>tokenIndex>=item.startToken&&tokenIndex<item.endToken);
    const index=Math.max(0,found);
    return {index,sentence:sentences[index]||sentences[0]};
  }
  function updateSubtitles(){
    if(!activeClip)return;
    const video=$('clipSavedVideo'),time=Number(video.currentTime)||0;
    const index=activeClipIndex(time);
    const {index:sentenceIndex,sentence}=subtitleSentenceAt(time,index);
    if(!sentence)return;
    const box=$('clipSubtitles'),english=$('clipEnglishSubtitles');
    if(sentenceIndex!==captionSentenceIndex){
      captionSentenceIndex=sentenceIndex;
      box.replaceChildren();
      const words=clipTokens(activeClip.text);
      for(let i=sentence.startToken;i<sentence.endToken&&i<words.length;i++){
        if(i>sentence.startToken)box.append(document.createTextNode(' '));
        const button=document.createElement('button');
        button.type='button';button.textContent=words[i];
        button.className='media-subtitle-word';button.dataset.index=String(i);
        const normalized=words[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLocaleLowerCase();
        button.addEventListener('click',()=>showClipWord(words[i],dictionary(activeClip.language).get(normalized)));
        box.append(button);
      }
      const englishText=activeClip.language==='en'?'':String(sentence.english||'');
      english.textContent=englishText||(
        activeClip.language==='en'?'':'English translation is being prepared…');
      english.hidden=activeClip.language==='en';
      captionWordIndex=-2;
    }
    if(index!==captionWordIndex){
      const old=box.querySelector('.media-speaking');old?.classList.remove('media-speaking');
      const active=index>=0?box.querySelector('[data-index="'+index+'"]'):null;
      active?.classList.add('media-speaking');
      const transcript=$('clipTranscript');
      transcript.querySelector('.media-speaking')?.classList.remove('media-speaking');
      const target=index>=0?transcript.querySelector('[data-index="'+index+'"]'):null;
      target?.classList.add('media-speaking');
      captionWordIndex=index;
    }
  }
  function animateClipCaptions(){
    if(captionFrame){cancelAnimationFrame(captionFrame);captionFrame=0;}
    const tick=()=>{
      captionFrame=0;
      updateSubtitles();
      if(activeClip&&!$('clipSavedVideo').paused&&!$('clipSavedVideo').ended)
        captionFrame=requestAnimationFrame(tick);
    };
    captionFrame=requestAnimationFrame(tick);
  }
  async function translateOldClip(clip){
    if(!clip?.text||clip.language==='en')return null;
    const response=await fetch('/study-clip-translate',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({language:clip.language,text:clip.text}),
      signal:AbortSignal.timeout(55000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Cannot translate clip script.');
    const sentences=clipSentences(clip.text);
    if(!Array.isArray(data.sentences)||data.sentences.length!==sentences.length)
      throw new Error('Incomplete bilingual subtitles');
    const captions=sentences.map((part,i)=>({
      ...part,english:String(data.sentences[i].english||'').trim()
    }));
    const stored=await getClip(clip.id)||clip;
    const revised={...stored,captionSentences:captions};
    await putClip(revised);
    if(activeClip?.id===clip.id){
      activeClip={...activeClip,captionSentences:captions};
      captionSentenceIndex=-1;updateSubtitles();
      status('clipSyncStatus',activeClip.aligned?
        'Accurate spoken-word timing · English translation ready':
        'Bilingual subtitles ready · Word timing is estimated until synced');
    }
    return revised;
  }
  async function syncClipSubtitles(clip,{force=false}={}){
    if(!clip?.blob?.size)return;
    if(clip.aligned&&clip.wordTimes?.length===clipTokens(clip.text).length&&
      (clip.language==='en'||clip.captionSentences?.some(s=>s.english))&&!force)return;
    if(captionPending.has(clip.id))return captionPending.get(clip.id);
    const requestedId=clip.id;
    if(activeClip?.id===requestedId){
      $('clipSyncButton').disabled=true;
      status('clipSyncStatus','Analyzing recorded speech and aligning English subtitles…');
    }
    const work=(async()=>{
      try{
        if(clip.blob.size>=24*1024*1024)throw new Error('This video is too large for automatic alignment (24 MB limit).');
        const format=/mp4/i.test(clip.blob.type)?'mp4':'webm';
        const response=await fetch('/study-clip-align',{
          method:'POST',
          headers:{'Content-Type':'application/octet-stream',
            'X-Clip-Language':clip.language,
            'X-Clip-Format':format,
            'X-Clip-Script':encodeURIComponent(clip.text.slice(0,3800)),
            'X-Clip-Translations-Ready':clip.captionSentences?.some(s=>s.english)?'1':'0'},
          body:clip.blob,signal:AbortSignal.timeout(110000)
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Could not synchronize subtitles.');
        const expected=clipTokens(clip.text).length;
        const wordTimes=Array.isArray(data.wordTimes)&&data.wordTimes.length===expected?data.wordTimes:[];
        const aligned=data.aligned===true&&wordTimes.length===expected;
        const original=clipSentences(clip.text);
        const captions=Array.isArray(data.sentences)&&data.sentences.length===original.length?
          original.map((s,i)=>({...s,english:String(data.sentences[i].english||'')})):original;
        const latest=await getClip(clip.id)||clip;
        const availableCaptions=captions.some(c=>c.english)?captions:
          (latest.captionSentences?.some(c=>c.english)?latest.captionSentences:captions);
        const revised={...latest,wordTimes,aligned,captionSentences:availableCaptions,
          captionConfidence:Number(data.confidence)||0,captionUpdatedAt:new Date().toISOString()};
        await putClip(revised);
        if(activeClip?.id===requestedId){
          activeClip=revised;captionSentenceIndex=-1;captionWordIndex=-2;
          updateSubtitles();
          const englishReady=revised.language==='en'||revised.captionSentences.some(x=>x.english);
          status('clipSyncStatus',aligned
            ?'Synchronized to recorded speech'+(englishReady?' · Bilingual captions ready':' · English translation pending')
            :(englishReady?'English captions ready · Word alignment needs another attempt':
              'Subtitle alignment unavailable · Try Sync subtitles again'));
        }
        if(revised.language!=='en'&&!revised.captionSentences?.some(x=>x.english)){
          try{await translateOldClip(revised)}catch(error){
            console.warn('Supplemental translation unavailable:',error);
          }
        }
        return revised;
      }catch(error){
        console.warn('Clip subtitle alignment unavailable:',error);
        // Even oversized or unsupported legacy videos can still have their
        // FR/NL + English captions translated from the stored script.
        if(clip.language!=='en'&&!clip.captionSentences?.some(x=>x.english)){
          try{return await translateOldClip(clip)}catch(translationError){
            console.warn('Clip bilingual translation unavailable:',translationError);
          }
        }
        if(activeClip?.id===requestedId)
          status('clipSyncStatus','Word timing unavailable: '+String(error.message||error).slice(0,110)+
            '. Video playback and original script remain available.');
        return null;
      }finally{
        captionPending.delete(requestedId);
        if(activeClip?.id===requestedId)$('clipSyncButton').disabled=false;
      }
    })();
    captionPending.set(requestedId,work);
    return work;
  }
  async function selectClip(clip){
    if(!clip)return;
    const selection=++captionRequestId;
    // Reload metadata after subtitle alignment was saved. The folder button
    // may still hold an older copy from the previous render.
    clip=await getClip(clip.id)||clip;
    if(selection!==captionRequestId)return;
    cleanClipVideo();
    activeClip=clip;
    $('clipPlayback').hidden=false;
    const number=clip.number?'Clip '+clip.number:'Saved clip';
    status('clipPlaybackTitle',number+' · '+clip.title);
    status('clipPlaybackMeta',(NAMES[clip.persona]||'Avatar')+' · '+asDate(clip.createdAt)+
      ' · '+clip.language.toUpperCase()+' · Saved in My Clips on this device');
    const video=$('clipSavedVideo');
    video.controls=true;video.playsInline=true;video.preload='metadata';
    const original=clip.blob;
    // Old library entries may have a Blob without a valid media MIME type.
    // Keep their actual bytes intact and only restore the missing type.
    const typedBlob=original.type&&/^video\//i.test(original.type)?original:
      new Blob([original],{type:/mp4/i.test(clip.mimeType||'')?'video/mp4':'video/webm'});
    clipUrl=URL.createObjectURL(typedBlob);
    video.src=clipUrl;
    video.load();
    $('clipPlayButton').hidden=false;
    showClipPlaybackMessage('');
    status('clipWordDetail','Tap a script word to pause the video and see its English meaning.');
    renderTokens($('clipTranscript'),clip.text,dictionary(clip.language),-1,showClipWord);
    captionSentenceIndex=-1;captionWordIndex=-2;
    status('clipSyncStatus',clip.aligned&&clip.wordTimes?.length?
      'Synchronized from the recorded voice · Replaying costs no Anam credits':
      'Preparing accurate audio timing and English sentence subtitles…');
    $('clipSyncButton').disabled=false;
    $('clipSyncButton').onclick=()=>void syncClipSubtitles(activeClip,{force:true});
    updateSubtitles();
    $('clipDownloadButton').onclick=()=>{
      const a=document.createElement('a');a.href=clipUrl;
      a.download='ecl-clip-'+(clip.number||'saved')+'-'+clip.persona+'-'+
        clip.createdAt.slice(0,10)+(clip.blob.type.includes('mp4')?'.mp4':'.webm');
      a.click();
    };
    // Show BOTH French/Dutch and English immediately if this Clip was
    // prepared with bilingual subtitles. For legacy videos, translate their
    // saved script first, independently of the slower audio alignment.
    const englishReady=clip.language==='en'||clip.captionSentences?.some(x=>x.english);
    if(!englishReady){
      void translateOldClip(clip).then(translated=>{
        const updated=translated||clip;
        if(!updated.aligned||!updated.wordTimes?.length)
          return syncClipSubtitles(updated);
      }).catch(error=>{
        console.warn('Legacy subtitle translation:',error);
        return syncClipSubtitles(clip);
      });
    }else if(!clip.aligned||!clip.wordTimes?.length){
      void syncClipSubtitles(clip);
    }
  }
  async function renderClips(){
    const lang=getLanguage(),list=$('clipLibrary'),seq=++clipsRenderSequence;
    list.replaceChildren();
    const all=await allClips();
    if(seq!==clipsRenderSequence||lang!==getLanguage())return;
    let highest=Math.max(read('clip.last-number','all',0),
      all.reduce((max,c)=>Math.max(max,Number(c.number)||0),0));
    // Stable chronological Clip 1, Clip 2, etc., including legacy videos.
    // Never reuse a number after deleting an existing saved Clip.
    for(const clip of [...all].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
      if(Number(clip.number)>0)continue;
      clip.number=++highest;
      await putClip(clip);
    }
    write('clip.last-number','all',highest);
    // Keep one IndexedDB (no destructive migration) but show only the
    // current language. Other-language videos remain untouched and accessible
    // immediately when the user switches their learning language.
    const clips=all.filter(c=>c.language===lang)
      .sort((a,b)=>Number(a.number)-Number(b.number));
    status('clipLibraryCount',clips.length+' '+langName()+' clips');
    if(!clips.length){
      list.textContent='No '+langName()+' clips yet. Select New to create one.';
      $('clipPlayback').hidden=true;activeClip=null;cleanClipVideo();return;
    }
    for(const clip of clips){
      const row=document.createElement('div');row.className='media-library-row';
      const b=document.createElement('button');b.type='button';
      b.className='media-library-item clip-folder-item'+(activeClip?.id===clip.id?' clip-folder-active':'');
      b.setAttribute('aria-label','Open Clip '+clip.number+': '+clip.title);
      const number=document.createElement('span');number.className='clip-file-number';
      number.textContent='Clip '+clip.number;
      const title=document.createElement('strong');title.textContent=clip.title;
      const meta=document.createElement('small');
      meta.textContent=clip.language.toUpperCase()+' · '+
        (NAMES[clip.persona]||'Avatar')+' · '+asDate(clip.createdAt)+
        ' · '+Math.round(clip.duration||60)+'s';
      b.append(number,title,meta);
      b.addEventListener('click',()=>{
        for(const item of list.querySelectorAll('.clip-folder-active'))
          item.classList.remove('clip-folder-active');
        b.classList.add('clip-folder-active');
        void selectClip(clip).then(()=>{
          // On mobile the video is below the library. Bring it into view
          // without requiring a manual scroll through the whole editor.
          if(window.innerWidth<=1010)
            $('clipPlayback').scrollIntoView?.({behavior:'smooth',block:'start'});
        }).catch(error=>showClipPlaybackMessage('Could not open saved clip: '+error.message));
      });
      const del=document.createElement('button');del.type='button';
      del.className='media-delete';del.textContent='Delete';
      del.setAttribute('aria-label','Delete Clip '+clip.number);
      del.addEventListener('click',async()=>{
        if(!confirm('Delete Clip '+clip.number+' permanently from this device?'))return;
        await removeClip(clip.id);
        if(activeClip?.id===clip.id)activeClip=null;
        await renderClips();
      });
      row.append(b,del);list.append(row);
    }
    if(seq!==clipsRenderSequence||lang!==getLanguage())return;
    const requested=clips.find(x=>x.id===activeClip?.id)||clips[clips.length-1];
    await selectClip(requested);
    for(const b of list.querySelectorAll('.clip-folder-item')){
      b.classList.toggle('clip-folder-active',
        b.getAttribute('aria-label')==='Open Clip '+requested.number+': '+requested.title);
    }
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
    $('clipCancelButton').hidden=true;renderClipSelection();
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
    if(saving||preparingClip)return;
    const lang=getLanguage(),persona=$('clipPersona').value;
    const data=clipDraft;
    if(!data?.text||!selectedClipWords.length||data.language!==lang||
       data.languageValidated!==true||data.validationVersion!==2){
      status('clipStatus','This script is not verified as '+langName()+' only. Press Prepare again before Run.');return;
    }
    if(data.theme!==$('clipTheme').value){
      status('clipStatus','Topic changed. Press Prepare again before Run.');return;
    }
    if(!window.MediaRecorder){status('clipStatus','Recording is not supported on this browser. Use updated Safari or Chrome.');return}
    saving=true;let seq=++liveSequence,recorded=[];
    // Start WebAudio from the Run tap (iOS may otherwise suspend analyzers).
    // It only MEASURES remote speech: it never changes or replays the audio.
    let soundContext=null,speechAnalyser=null,soundSamples=null,soundStarted=false;
    let lastSoundAt=0,personaDoneAt=0,personaSpoken=false;
    try{
      const Context=window.AudioContext||window.webkitAudioContext;
      if(Context){
        soundContext=new Context();
        void soundContext.resume?.().catch?.(()=>{});
      }
    }catch(error){console.warn('Voice monitor unavailable:',error)}
    renderClipSelection();
    $('clipCancelButton').hidden=false;
    status('clipScript',data.text);
    status('clipStatus','Connecting '+(NAMES[persona]||'your avatar')+' to record your prepared script…');
    try{
      const tokenResp=await fetch('/anam-session',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({persona,targetLanguage:lang,topic:'open'})});
      const token=await tokenResp.json();
      if(!tokenResp.ok||!token.sessionToken)throw new Error(
        [token.error||'Anam connection unavailable',token.anamMessage].filter(Boolean).join(' · '));
      if(seq!==liveSequence||lang!==getLanguage())return;
      client=createClient(token.sessionToken,{disableInputAudio:true});
      // Anam delivers video and audio in SEPARATE remote MediaStreams.
      // The SDK attaches only the video stream to the HTML video element.
      // Collect both SDK events before creating one recordable MediaStream.
      let remoteVideo=null,remoteAudio=null,notifyTracks=()=>{};
      client.addListener(AnamEvent.VIDEO_STREAM_STARTED,stream=>{
        remoteVideo=stream;notifyTracks();
      });
      client.addListener(AnamEvent.AUDIO_STREAM_STARTED,stream=>{
        remoteAudio=stream;notifyTracks();
      });
      if(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED){
        client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,event=>{
          if(event?.role!=='persona')return;
          if(event.content)personaSpoken=true;
          if(event.endOfSpeech)personaDoneAt=Date.now();
        });
      }
      $('clipLivePanel').hidden=false;
      await client.streamToVideoElement('clipLiveVideo');
      if(seq!==liveSequence||lang!==getLanguage()){stopStream();return}
      const tracksReady=()=>remoteVideo?.getVideoTracks().length>0 &&
        remoteAudio?.getAudioTracks().length>0;
      if(!tracksReady()){
        status('clipStatus','Waiting for avatar video and voice…');
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{
            notifyTracks=()=>{};
            reject(new Error('Anam video or audio did not arrive. Please try again.'));
          },15000);
          notifyTracks=()=>{
            if(tracksReady()){clearTimeout(timeout);notifyTracks=()=>{};resolve()}
          };
          notifyTracks();
        });
      }
      if(seq!==liveSequence||lang!==getLanguage()){stopStream();return}
      const audioTracks=remoteAudio.getAudioTracks();
      const videoTracks=remoteVideo.getVideoTracks();
      if(!audioTracks.length||!videoTracks.length)
        throw new Error('Anam did not send both audio and video tracks.');
      const combined=new MediaStream([...videoTracks,...audioTracks]);
      if(soundContext){
        try{
          const source=soundContext.createMediaStreamSource(remoteAudio);
          speechAnalyser=soundContext.createAnalyser();
          speechAnalyser.fftSize=1024;
          soundSamples=new Uint8Array(speechAnalyser.fftSize);
          source.connect(speechAnalyser);
          // No connection to speakers: the video itself already plays audio.
        }catch(error){
          console.warn('Clip speech energy unavailable:',error);
          speechAnalyser=null;
        }
      }
      const video=$('clipLiveVideo');
      video.srcObject=combined;
      // An explicit play attempt is helpful when Safari changes tracks after
      // the first frame. Recording still uses the original remote tracks.
      void video.play().catch(()=>{});
      // Browser format support differs by iOS version. Try each supported
      // container and only start recording when the constructor accepts it.
      let r=null,type='';
      for(const candidate of ['video/mp4','video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus','video/webm']){
        if(typeof MediaRecorder.isTypeSupported==='function'&&
           !MediaRecorder.isTypeSupported(candidate))continue;
        try{r=new MediaRecorder(combined,{mimeType:candidate});type=candidate;break}
        catch(error){console.warn('Clip format fallback:',candidate,error)}
      }
      if(!r){r=new MediaRecorder(combined);type=r.mimeType||'video/webm'}
      recorder=r;
      r.addEventListener('dataavailable',e=>{if(e.data.size)recorded.push(e.data)});
      const script=data.text;
      const wordCount=clipTokens(script).length;
      // Deliver at a learner-friendly ~80–115 wpm. The avatar may have a
      // fixed built-in TTS voice speed, so sentence spacing is deliberate and
      // the total narration is spread calmly rather than rushed in 30s.
      const millisPerWord=Math.max(500,Math.min(760,56000/Math.max(1,wordCount)));
      const phrases=clipSentences(script).flatMap(sentence=>{
        const tokens=clipTokens(sentence.text);
        const chunks=[];
        for(let offset=0;offset<tokens.length;offset+=9)
          chunks.push(tokens.slice(offset,offset+9).join(' '));
        return chunks;
      }).filter(Boolean);
      if(!phrases.length)throw new Error('Empty clip script.');
      const waitDuringClip=ms=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{abortWait=null;resolve()},Math.max(0,ms));
        abortWait=()=>{clearTimeout(timer);abortWait=null;reject(new Error('Clip cancelled'))};
      });
      liveSince=Date.now();
      r.start(1000);
      status('clipStatus','Recording · speaking slowly');
      const stream=client.createTalkMessageStream();
      let emittedWords=0;
      for(let i=0;i<phrases.length;i++){
        if(seq!==liveSequence||lang!==getLanguage())throw new Error('Clip cancelled');
        // Each short segment is transmitted separately, preserving the exact
        // approved script. This avoids one long TTS burst at full speed.
        await stream.streamMessageChunk(phrases[i]+(i<phrases.length-1?' ':''),false);
        emittedWords+=clipTokens(phrases[i]).length;
        status('clipStatus','Speaking · '+Math.min(100,Math.round(emittedWords/wordCount*100))+'%');
        if(i<phrases.length-1)
          await waitDuringClip(clipTokens(phrases[i]).length*millisPerWord);
      }
      await stream.endMessage();
      const finalSentAt=Date.now();
      // Stop at the end of the ACTUAL voice, not a fixed 60/80-second timer.
      // Prefer observed audio silence. When WebAudio is unavailable in Safari,
      // use the avatar end-of-speech event or a short fallback tail.
      await new Promise((resolve,reject)=>{
        abortWait=()=>{clearInterval(clock);clock=null;abortWait=null;
          reject(new Error('Clip cancelled'))};
        clock=setInterval(()=>{
          if(seq!==liveSequence||lang!==getLanguage()){
            const cancel=abortWait;abortWait=null;if(cancel)cancel();return;
          }
          const now=Date.now();
          if(speechAnalyser&&soundSamples&&soundContext?.state==='running'){
            speechAnalyser.getByteTimeDomainData(soundSamples);
            let total=0;
            for(const value of soundSamples){const n=(value-128)/128;total+=n*n}
            const rms=Math.sqrt(total/soundSamples.length);
            if(rms>.014){soundStarted=true;lastSoundAt=now}
          }
          const seconds=Math.max(0,Math.floor((now-liveSince)/1000));
          status('clipStatus','Finishing voice · '+seconds+'s');
          const sinceFinal=now-finalSentAt;
          const finishedByAudio=soundStarted&&sinceFinal>=1500&&now-lastSoundAt>=1900;
          const finishedByEvent=!soundStarted&&personaDoneAt&&now-personaDoneAt>=2800&&sinceFinal>=2400;
          // Some Safari WebRTC streams cannot be analyzed, and some Anam
          // versions don't report persona endOfSpeech. Still end the recording
          // promptly rather than storing 30 seconds of silence.
          const finishedByFallback=!soundStarted&&!personaDoneAt&&sinceFinal>=7500;
          const deadline=now-liveSince>=105000;
          if(finishedByAudio||finishedByEvent||finishedByFallback||deadline){
            clearInterval(clock);clock=null;abortWait=null;
            if(deadline&&speechAnalyser&&soundStarted&&now-lastSoundAt<1200)
              reject(new Error('Avatar speech exceeded the recording limit. Clip not saved.'));
            else resolve();
          }
        },250);
      });
      if(seq!==liveSequence)return;
      saving=false;
      await finishRecording(true);
      if(!recorded.length)throw new Error('No recorded video data was received.');
      const blob=new Blob(recorded,{type:r.mimeType||type});
      if(blob.size<10000)throw new Error('The recording was incomplete. Please retry.');
      const allSaved=await allClips();
      const nextNumber=Math.max(read('clip.last-number','all',0),
        allSaved.reduce((n,c)=>Math.max(n,Number(c.number)||0),0))+1;
      const clip={id:'clip-'+Date.now(),number:nextNumber,createdAt:new Date().toISOString(),
        language:lang,persona,title:data.title,text:script,theme:data.theme,
        usedWords:data.usedWords,selectedWords:data.selectedWords,mimeType:type,
        captionSentences:Array.isArray(data.captionSentences)?data.captionSentences:[],
        blob,duration:(Date.now()-liveSince)/1000};
      await putClip(clip);
      write('clip.last-number','all',nextNumber);
      status('clipStatus','Saved! Replay this video any time without starting Anam again.');
      setClipView('clips');
    }catch(e){
      console.warn('Clip creation failed',e);
      status('clipStatus',String(e.message||'Could not save clip.'));
      if(recorder)await finishRecording(false);else stopStream();
    }finally{
      saving=false;abortWait=null;recorded=[];$('clipCancelButton').hidden=true;
      if(clock){clearInterval(clock);clock=null}
      if(soundContext)void soundContext.close?.().catch?.(()=>{});
      renderClipSelection();
    }
  }
  makeOption($('songTheme'),THEMES.map(x=>[x,x]));
  makeOption($('clipTheme'),THEMES.map(x=>[x,x]));
  makeOption($('songGenre'),['Pop','Acoustic','Indie','Hip-hop','Jazz','Electronic','Ballad'].map(x=>[x,x]));
  makeOption($('clipPersona'),Object.entries(NAMES));
  $('clipPersona').value=localStorage.getItem('ecl.selectedPersona.v1')||'emma';
  restoreClipWorkspace();
  $('songRunButton').addEventListener('click',makeSong);
  $('clipVideosTab').addEventListener('click',()=>setClipView('clips'));
  $('clipNewTab').addEventListener('click',()=>setClipView('new'));
  $('clipWordsButton').addEventListener('click',()=>{
    const panel=$('clipWordsPanel');panel.hidden=!panel.hidden;
    $('clipWordsButton').setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden)renderClipWordUniverse();
  });
  $('clipWordsSearch').addEventListener('input',renderClipWordUniverse);
  $('clipMixButton').addEventListener('click',mixClipWords);
  $('clipPrepareButton').addEventListener('click',()=>void prepareClipScript());
  $('clipTheme').addEventListener('change',()=>{
    if(clipDraft)invalidateClipDraft();
    status('clipStatus','Topic updated. Press Prepare to create a new script.');
  });
  $('clipRunButton').addEventListener('click',runClip);
  $('clipCancelButton').addEventListener('click',cancelClip);
  $('clipSavedVideo').addEventListener('timeupdate',updateSubtitles);
  $('clipSavedVideo').addEventListener('loadedmetadata',updateSubtitles);
  $('clipSavedVideo').addEventListener('seeked',updateSubtitles);
  $('clipPlayButton').addEventListener('click',playSavedClip);
  $('clipSavedVideo').addEventListener('play',()=>{
    $('clipPlayButton').hidden=true;
    animateClipCaptions();
  });
  $('clipSavedVideo').addEventListener('pause',()=>{
    if(captionFrame){cancelAnimationFrame(captionFrame);captionFrame=0;}
    if($('clipSavedVideo').ended)return;
    $('clipPlayButton').hidden=false;
    updateSubtitles();
  });
  $('clipSavedVideo').addEventListener('ended',()=>{
    $('clipPlayButton').hidden=false;
    showClipPlaybackMessage('');
    updateSubtitles();
  });
  $('clipSavedVideo').addEventListener('error',()=>{
    $('clipPlayButton').hidden=false;
    const code=$('clipSavedVideo').error?.code;
    showClipPlaybackMessage(code===4?
      'This older video format is not supported by this browser. Try Download video.':
      'The saved video could not be loaded. Try Play again or Download video.',{error:true});
  });
  window.addEventListener('pagehide',()=>{void cancelClip();cleanClipVideo()});
  function onPage(next){
    if(current==='clips'&&next!=='clips')void cancelClip();
    current=next;
    if(next==='song'){showInventory();renderSongs()}
    if(next==='clips'){restoreClipWorkspace();setClipView(clipView)}
  }
  function refreshLanguage(){
    if(current==='clips')void cancelClip();
    if(current==='song'){showInventory();renderSongs()}
    if(current==='clips'){
      prepareSequence++;preparingClip=false;
      $('clipWordsPanel').hidden=true;
      $('clipWordsButton').setAttribute('aria-expanded','false');
      $('clipWordsSearch').value='';
      clipsRenderSequence++;
      restoreClipWorkspace();activeClip=null;cleanClipVideo();setClipView(clipView);
    }
  }
  return {onPage,refreshLanguage,stop:cancelClip};
}
