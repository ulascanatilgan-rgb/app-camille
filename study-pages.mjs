// ECL's five-page learning experience. No Anam/Realtime audio session is
// required in Slide or News; browser speech reads these study materials.
import { initMediaPages } from './media-pages.mjs';
export function initStudyPages({getLanguage,getTalkWords,stopTalk}) {
  const $=id=>document.getElementById(id);
  const tabs=[...document.querySelectorAll('.study-nav-button')];
  const pages={talk:$('talkPage'),slide:$('slidePage'),news:$('newsPage'),song:$('songPage'),clips:$('clipsPage')};
  const media=initMediaPages({getLanguage,getTalkWords});
  const locale={fr:'fr-FR',nl:'nl-BE',en:'en-GB'};
  let currentPage='talk', cards=[], cardIndex=0, deckLang='', pendingDeck=false;
  let newsData=null,newsLang='',newsReaderIndex=-1,newsPlaying=false,newsPaused=false;
  let archiveStory=null,completeNews=false,wordLookupSeq=0,newsGeneration=0;
  let speechIndex=0,speechSeq=0,wordHighlight=-1,speechOffset=0;
  let newsHighlightTimer=null;
  let newsAudioGeneration=0,newsAudioActive=false,activeAudioId='',resumeAudioTime=null,newsScrubbing=false;
  const newsAudioCache=new Map();
  const newsAudio=$('newsAudioPlayer');
  let lastUpdateCacheKey='';
  const info=(id,msg)=>{const e=$(id);if(e)e.textContent=msg};
  const store=(key,obj)=>{try{localStorage.setItem(key,JSON.stringify(obj))}catch{}};
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const key=(group,lang=getLanguage())=>'ecl.'+group+'.v1.'+lang;
  const validWords=()=>getTalkWords().filter(w=>w?.nl&&w?.en&&(!w.language||w.language===getLanguage())).slice(-800);
  const score=()=>read(key('slide.results'),[]);
  const newsWords=()=>read(key('news.words'),[]);
  const newsArchive=()=>read(key('news.archive'),[]);
  const currentArticle=()=>archiveStory||newsData?.stories?.[newsReaderIndex];
  function saveNewsArchive(stories){
    const archive=newsArchive(),byId=new Map(archive.map((a,i)=>[a.id,i]));
    for(const story of stories) {
      if(!story?.id)continue;
      const oldIndex=byId.get(story.id);
      if(oldIndex!==undefined){
        const old=archive[oldIndex];
        const oldLength=old.sentences?.reduce((n,s)=>n+(s.target?.length||0),0)||0;
        const newLength=story.sentences?.reduce((n,s)=>n+(s.target?.length||0),0)||0;
        if(newLength>oldLength)archive[oldIndex]={...story,archivedAt:old.archivedAt||new Date().toISOString()};
        continue;
      }
      archive.push({...story,archivedAt:new Date().toISOString()});
      byId.set(story.id,archive.length-1);
    }
    archive.sort((a,b)=>String(b.archivedAt||b.publishedAt||'').localeCompare(String(a.archivedAt||a.publishedAt||'')));
    store(key('news.archive'),archive);
  }
  const safeDate=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'});
  const say=(text)=>{
    if(!('speechSynthesis' in window))return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(String(text).slice(0,330));
    u.lang=locale[getLanguage()]||'nl-BE';u.rate=.88;
    window.speechSynthesis.speak(u);
  };
  function stopNews() {
    if(newsAudioActive&&Number.isFinite(newsAudio?.currentTime)){
      followNewsAudio();
      resumeAudioTime=newsAudio.currentTime;
    }
    newsPlaying=false;newsPaused=false;speechSeq++;
    newsAudioGeneration++;
    if(newsAudio){newsAudio.pause();}
    newsAudioActive=false;
    if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
    window.speechSynthesis?.cancel?.();
    const btn=$('newsRunButton');if(btn)btn.textContent='▶ Continue';
    const pause=$('newsPauseButton');if(pause)pause.textContent='Continue';
  }
  function updateCounts() {
    const r=score();
    info('slideTotal',String(r.length));
    info('slideCorrect',String(r.filter(x=>x.correct).length));
    info('slideWrong',String(r.filter(x=>!x.correct).length));
  }
  function changePage(next) {
    if(!pages[next]||next===currentPage)return;
    const wasTalk=currentPage==='talk';
    if(currentPage==='news')stopNews();
    currentPage=next;
    document.body.dataset.eclPage=next;
    for(const [name,node] of Object.entries(pages))node.hidden=name!==next;
    document.querySelector('.topic-strip').hidden=next!=='talk';
    document.querySelector('.conversation-provider-strip').hidden=next!=='talk';
    document.getElementById('talkToolsStrip').hidden=next!=='talk';
    for(const btn of tabs){
      const selected=btn.dataset.page===next;
      btn.classList.toggle('selected',selected);
      if(selected)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
    }
    // Leaving Talk intentionally ends paid Anam/OpenAI sessions.
    if(wasTalk && next!=='talk')Promise.resolve(stopTalk()).catch(err=>console.warn('Talk did not fully stop:',err));
    media.onPage(next);
    if(next==='slide')void loadSlide();
    if(next==='news'){
      renderNews();
      if(!newsData?.stories?.length||new Date(newsData.updatedAt).toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'})!==safeDate())void updateNews();
    }
  }
  for(const tab of tabs)tab.addEventListener('click',()=>changePage(tab.dataset.page));

  const shuffled=items=>[...items].sort(()=>Math.random()-.5);
  function setSlideEmpty(message) {
    const card=$('slideCard');card.hidden=true;
    $('slideLeftWord').disabled=true;$('slideRightWord').disabled=true;
    info('slideStatus',message);
  }
  function renderSlide() {
    updateCounts();
    const item=cards[cardIndex%cards.length];
    if(!item){setSlideEmpty('No cards yet. Open Talk to learn words, then return to Slide.');return}
    $('slideCard').hidden=false;
    $('slideLeftWord').disabled=false;$('slideRightWord').disabled=false;
    info('slideStatus',((cardIndex%cards.length)+1)+' / '+cards.length+' · Swipe anywhere on the card or tap an answer');
    info('slideDefinition',item.definition);
    info('slideSentenceEnglish',item.englishSentence||'');
    const sentence=$('slideSentence');sentence.replaceChildren();
    const fragments=item.sentence.split('____');
    const before=document.createTextNode(fragments[0]||'');
    const gap=document.createElement('span');gap.className='slide-masked-word';
    gap.textContent=item.word;gap.setAttribute('aria-label','Hidden answer');
    gap.setAttribute('title','Find the missing word');
    sentence.append(before,gap,document.createTextNode(fragments[1]||''));
    info('slideLeftWord', '');info('slideRightWord','');
    for(const [id,answer,side] of [
      ['slideLeftWord',item.correctSide==='left'?item.word:item.wrong,'LEFT'],
      ['slideRightWord',item.correctSide==='right'?item.word:item.wrong,'RIGHT']
    ]) {
      const label=$(id);
      const meta=document.createElement('span');meta.textContent=side==='LEFT'?'← LEFT':'RIGHT →';
      const strong=document.createElement('strong');strong.textContent=answer;
      label.append(meta,strong);
    }
    const c=$('slideCard');
    // Keep visible success/failure feedback until the next attempt.
    c.classList.remove('swipe-left','swipe-right','fly-left','fly-right','dragging','snap-back');
    c.style.transform='';gesture=null;slideLocked=false;
    $('slideLeftWord').classList.remove('direction-active');$('slideRightWord').classList.remove('direction-active');
  }
  let slideAudioCtx=null;
  function playSlideResultSound(correct){
    // Original synthetic two-tone arcade feedback, not sampled copyrighted SFX.
    try {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context)return;
      slideAudioCtx ||= new Context();
      if(slideAudioCtx.state==='suspended')void slideAudioCtx.resume();
      const now=slideAudioCtx.currentTime;
      const notes=correct?[[660,.00,.10,'sine'],[880,.10,.12,'sine'],[1320,.23,.17,'sine']]:
        [[220,.00,.20,'sawtooth'],[157,.14,.27,'sawtooth']];
      for(const [hz,delay,length,type] of notes){
        const osc=slideAudioCtx.createOscillator();
        const gain=slideAudioCtx.createGain();
        osc.type=type;osc.frequency.setValueAtTime(hz,now+delay);
        if(!correct)osc.frequency.exponentialRampToValueAtTime(hz*.72,now+delay+length);
        gain.gain.setValueAtTime(.0001,now+delay);
        gain.gain.exponentialRampToValueAtTime(correct?.085:.048,now+delay+.017);
        gain.gain.exponentialRampToValueAtTime(.0001,now+delay+length);
        osc.connect(gain);gain.connect(slideAudioCtx.destination);
        osc.start(now+delay);osc.stop(now+delay+length+.012);
      }
    }catch(error){console.warn('Slide feedback sound unavailable',error)}
  }
  function answerSlide(side) {
    const item=cards[cardIndex%cards.length];
    if(!item||pendingDeck||slideLocked)return;
    slideLocked=true;
    const correct=side===item.correctSide;
    const results=score();results.push({
      id:item.id,word:item.word,meaning:item.meaning,correct,chosen:side,
      sentence:item.sentence.replace('____',item.word),definition:item.definition,
      at:new Date().toISOString()
    });store(key('slide.results'),results.slice(-1000));
    const feedback=$('slideFeedback');
    feedback.className='slide-feedback '+(correct?'slide-feedback-correct':'slide-feedback-wrong');
    feedback.replaceChildren();
    const resultLabel=document.createElement('strong');
    resultLabel.textContent=correct?'✓ CORRECT':'× WRONG';
    const resultWord=document.createElement('span');
    resultWord.textContent=item.word+' — '+item.meaning;
    feedback.append(resultLabel,resultWord);
    playSlideResultSound(correct);
    const card=$('slideCard');
    gesture=null;
    $('slideLeftWord').disabled=true;$('slideRightWord').disabled=true;
    card.classList.remove('dragging','snap-back');
    card.style.transform='';
    card.classList.add(side==='left'?'fly-left':'fly-right');
    const langAtSwipe=getLanguage();
    const previousDeck=cards;
    if(slideAdvanceTimer)window.clearTimeout(slideAdvanceTimer);
    slideAdvanceTimer=window.setTimeout(()=>{
      slideAdvanceTimer=null;
      // No card should remain locked if a reload or page change intervenes.
      if(cards!==previousDeck){slideLocked=false;return;}
      cardIndex++;
      if(currentPage==='slide'&&deckLang===langAtSwipe)renderSlide();
      else {
        slideLocked=false;
        card.classList.remove('fly-left','fly-right');
        card.style.transform='';
      }
    },340);
    updateCounts();
  }
  $('slideLeftWord').addEventListener('click',()=>answerSlide('left'));
  $('slideRightWord').addEventListener('click',()=>answerSlide('right'));
  // Capture the pointer from the beginning (especially on iOS) and release
  // after each attempt. Choices are actual buttons and never start a drag.
  let gesture=null,slideLocked=false,slideAdvanceTimer=null,slideSnapTimer=null;
  const slide=$('slideCard');
  function resetSwipe(){
    gesture=null;
    slide.classList.remove('dragging');
    slide.classList.add('snap-back');
    slide.style.transform='';
    slide.querySelectorAll('.slide-choice').forEach(e=>e.classList.remove('direction-active'));
    if(slideSnapTimer)window.clearTimeout(slideSnapTimer);
    slideSnapTimer=window.setTimeout(()=>{
      slideSnapTimer=null;
      if(!gesture)slide.classList.remove('snap-back');
    },220);
  }
  slide.addEventListener('pointerdown',ev=>{
    if(slideLocked||pendingDeck||ev.button>0||!cards.length)return;
    // Keep swipe working when a finger starts on the LEFT/RIGHT buttons.
    // Ordinary taps still dispatch their normal click handler.
    if(slideSnapTimer){window.clearTimeout(slideSnapTimer);slideSnapTimer=null}
    slide.classList.remove('snap-back');
    gesture={id:ev.pointerId,x:ev.clientX,y:ev.clientY,dx:0,dy:0,tracking:false};
    // Capturing a button's pointer retargets its click to the card on iOS.
    // Only capture blank card areas; monitor the window for button-origin drags.
    if(!ev.target.closest('button')){
      try{slide.setPointerCapture(ev.pointerId)}catch{}
    }
  });
  const trackSwipe=ev=>{
    if(!gesture||ev.pointerId!==gesture.id||slideLocked)return;
    const dx=ev.clientX-gesture.x,dy=ev.clientY-gesture.y;
    gesture.dx=dx;gesture.dy=dy;
    if(!gesture.tracking){
      if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>12){
        gesture=null;
        try{if(slide.hasPointerCapture(ev.pointerId))slide.releasePointerCapture(ev.pointerId)}catch{}
        return;
      }
      if(Math.abs(dx)<9||Math.abs(dx)<=Math.abs(dy)*1.1)return;
      gesture.tracking=true;
      slide.classList.remove('snap-back');slide.classList.add('dragging');
    }
    slide.style.transform='translateX('+dx+'px) rotate('+(dx/20)+'deg)';
    const active=dx<-35?'left':dx>35?'right':'';
    $('slideLeftWord').classList.toggle('direction-active',active==='left');
    $('slideRightWord').classList.toggle('direction-active',active==='right');
    if(ev.cancelable)ev.preventDefault();
  };
  slide.addEventListener('pointermove',trackSwipe);
  window.addEventListener('pointermove',ev=>{
    if(gesture&&!slide.hasPointerCapture?.(gesture.id))trackSwipe(ev);
  });
  const finishSwipe=ev=>{
    if(!gesture||ev.pointerId!==gesture.id)return;
    const {tracking,dy}=gesture;
    const dx=ev.clientX-gesture.x;
    gesture=null;
    try{if(slide.hasPointerCapture(ev.pointerId))slide.releasePointerCapture(ev.pointerId)}catch{}
    if(tracking&&Math.abs(dx)>=Math.max(40,slide.clientWidth*.115)&&
      Math.abs(dx)>Math.abs(dy)*1.05)answerSlide(dx<0?'left':'right');
    else resetSwipe();
  };
  slide.addEventListener('pointerup',finishSwipe);
  // Safari occasionally releases capture before delivering pointerup to
  // the original card. Handle it globally too, without double-answering.
  window.addEventListener('pointerup',finishSwipe);
  slide.addEventListener('pointercancel',resetSwipe);
  // Older iOS versions do not always provide reliable Pointer Events.
  if(!window.PointerEvent){
    slide.addEventListener('touchstart',ev=>{
      if(slideLocked||pendingDeck||!ev.touches.length)return;
      const t=ev.touches[0];
      gesture={id:'touch',x:t.clientX,y:t.clientY,dx:0,dy:0,tracking:false};
    },{passive:true});
    slide.addEventListener('touchmove',ev=>{
      if(!gesture||gesture.id!=='touch'||!ev.touches.length)return;
      const t=ev.touches[0];
      gesture.dx=t.clientX-gesture.x;gesture.dy=t.clientY-gesture.y;
      if(Math.abs(gesture.dx)>12&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.1){
        gesture.tracking=true;
        slide.classList.add('dragging');
        slide.style.transform='translateX('+gesture.dx+'px) rotate('+(gesture.dx/22)+'deg)';
        if(ev.cancelable)ev.preventDefault();
      }
    },{passive:false});
    slide.addEventListener('touchend',()=>{
      if(!gesture||gesture.id!=='touch')return;
      const {dx,dy,tracking}=gesture;gesture=null;
      if(tracking&&Math.abs(dx)>=Math.max(40,slide.clientWidth*.115)&&Math.abs(dx)>Math.abs(dy))
        answerSlide(dx<0?'left':'right');
      else resetSwipe();
    });
    slide.addEventListener('touchcancel',resetSwipe);
  }
  slide.addEventListener('lostpointercapture',()=>{
    if(gesture&&gesture.tracking)resetSwipe();
  });
  slide.addEventListener('keydown',ev=>{
    if(ev.target!==slide)return;
    if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){
      ev.preventDefault();answerSlide(ev.key==='ArrowLeft'?'left':'right');
    }
  });
  function makeDeck(raw,lang) {
    return shuffled(raw).map((c,i)=>({...c,correctSide:Math.random()<.5?'left':'right'}));
  }
  async function loadSlide(force=false) {
    if(pendingDeck)return;
    if(slideAdvanceTimer){window.clearTimeout(slideAdvanceTimer);slideAdvanceTimer=null;}
    const lang=getLanguage(),previousLang=deckLang,priorCards=cards;
    deckLang=lang;slideLocked=false;gesture=null;
    updateCounts();
    const words=validWords();
    if(!words.length){cards=[];setSlideEmpty('No Talk words yet. Practice a conversation to collect new vocabulary.');return}
    const signature=words.map(w=>w.id||w.nl).join('|');
    const cached=read(key('slide.deck.v3',lang),{});
    if(!force&&cached.signature===signature&&Array.isArray(cached.cards)&&cached.cards.length){
      cards=makeDeck(cached.cards,lang);cardIndex=0;renderSlide();return;
    }
    pendingDeck=true;
    if(!priorCards.length||previousLang!==lang)setSlideEmpty('Preparing practice cards from your Talk words…');
    else info('slideStatus','Preparing new cards · current deck preserved until ready…');
    try {
      const input=shuffled(words).slice(0,24).map(w=>({id:String(w.id||w.nl),word:String(w.nl),meaning:String(w.en)}));
      const resp=await fetch('/study-slide-deck',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({language:lang,words:input})
      });
      const result=await resp.json();
      if(!resp.ok)throw new Error(result.error||'Card generation unavailable');
      if(getLanguage()!==lang)return;
      const accepted=Array.isArray(result.cards)?result.cards.filter(c=>c?.word&&c?.sentence?.includes('____')&&c?.wrong&&c?.definition&&c?.englishSentence):[];
      if(!accepted.length)throw new Error('No valid cards returned. Please try again.');
      store(key('slide.deck.v3',lang),{signature,cards:accepted});
      cards=makeDeck(accepted,lang);cardIndex=0;
      info('slideFeedback','');renderSlide();
    }catch(error){
      if(getLanguage()===lang){
        if(priorCards.length&&previousLang===lang){
          cards=priorCards;
          info('slideStatus','New cards unavailable · previous deck is ready. Swipe or tap an answer.');
          $('slideLeftWord').disabled=false;$('slideRightWord').disabled=false;
          slideLocked=false;
        }else setSlideEmpty(String(error.message||'Card generator unavailable'));
      }
    }
    finally{pendingDeck=false;}
  }
  $('slideReloadButton').addEventListener('click',()=>void loadSlide(true));

  // Word libraries are independent: Slide uses Talk words, News has its own.
  async function slideWordDetails(item) {
    const lang=getLanguage(),id=String(item.id||item.nl);
    const all=read(key('slide.deck.v3',lang),{}).cards||[];
    const extra=read(key('slide.details.v2',lang),{});
    const existing=all.find(w=>String(w.id)===id) || extra[id];
    if(existing)return existing;
    const response=await fetch('/study-slide-deck',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({language:lang,words:[{id,word:item.nl,meaning:item.en}]})
    });
    const data=await response.json();
    if(!response.ok||!data.cards?.[0])throw new Error(data.error||'Explanation unavailable');
    if(lang===getLanguage()){
      extra[id]=data.cards[0];store(key('slide.details.v2',lang),extra);
    }
    return data.cards[0];
  }
  function createPlay(label,text) {
    const play=document.createElement('button');play.type='button';play.className='study-word-audio';
    play.textContent='🎧';play.title=label;play.setAttribute('aria-label',label);
    play.addEventListener('click',ev=>{ev.stopPropagation();say(text)});
    return play;
  }
  function openWordLibrary(which) {
    stopNews();
    const dialog=$('studyWordsDialog'),lang=getLanguage(),isSlide=which==='slide';
    info('studyWordsTitle',isSlide?'Slide Words':'Article Words');
    info('studyWordsEyebrow',(isSlide?'TALK WORDS':'ARTICLE VOCABULARY')+' · '+lang.toUpperCase());
    const filters=$('studyWordsFilters');filters.replaceChildren();
    const options=isSlide?['All Words','Wrong Words','Correct Words']:['All Words'];
    const records=isSlide?validWords():newsWords(),results=score(),list=$('studyWordsList');
    let filterRun=0;
    function renderFilter(filter) {
      filterRun++;
      const run=filterRun;
      [...filters.children].forEach(e=>e.classList.toggle('active',e.textContent===filter));
      list.replaceChildren();
      let selected=records;
      if(isSlide && filter!=='All Words'){
        const good=filter==='Correct Words';
        const ids=new Set(results.filter(r=>r.correct===good).map(r=>r.id));
        selected=records.filter(w=>ids.has(w.id||w.nl));
      }
      if(!selected.length){
        const p=document.createElement('p');p.className='study-empty';
        p.textContent='No words in this category yet.';list.append(p);return;
      }
      for(const item of [...selected].reverse()) {
        const word=isSlide?item.nl:item.word;
        const row=document.createElement('div');row.className='study-word-row';
        const main=document.createElement('div');main.className='study-word-row-main';
        const heading=document.createElement('div');heading.className='study-word-row-heading';
        const expand=document.createElement('button');expand.type='button';
        expand.className='study-word-expand';expand.textContent=word+' · '+(isSlide?item.en:item.english);
        expand.setAttribute('aria-expanded','false');
        heading.append(expand);
        main.append(heading);
        const detail=document.createElement('div');detail.className='study-word-expanded';detail.hidden=true;
        main.append(detail);
        let loaded=false;
        const setDetail=(def,example)=>{
          detail.replaceChildren();
          const explanation=document.createElement('p');explanation.className='study-word-detail';
          explanation.textContent=def;
          const usage=document.createElement('p');usage.className='study-word-example';
          usage.textContent=example;
          const actions=document.createElement('div');actions.className='study-word-actions';
          actions.append(createPlay('Hear '+word,word),createPlay('Hear example sentence',example));
          detail.append(explanation,usage,actions);
        };
        expand.addEventListener('click',async()=>{
          const open=detail.hidden;
          detail.hidden=!open;expand.setAttribute('aria-expanded',String(open));
          if(!open||loaded)return;
          if(!isSlide){
            setDetail(item.definition,item.example);loaded=true;return;
          }
          detail.textContent='Preparing explanation and example…';
          try {
            const found=await slideWordDetails(item);
            if(run!==filterRun||lang!==getLanguage())return;
            const complete=found.sentence.replace('____',found.word);
            setDetail(found.definition,complete);loaded=true;
          }catch(err){
            detail.textContent='Could not prepare this example. Tap the word to retry.';
          }
        });
        const play=createPlay('Hear '+word,word);
        row.append(main,play);list.append(row);
      }
    }
    for(const option of options) {
      const button=document.createElement('button');button.type='button';button.textContent=option;
      button.addEventListener('click',()=>renderFilter(option));filters.append(button);
    }
    renderFilter('All Words');dialog.showModal();
  }
  function openSlideHistory() {
    const dialog=$('slideHistoryDialog'),list=$('slideHistoryList');
    list.replaceChildren();
    const results=score().slice().reverse();
    const heading=document.createElement('p');heading.className='slide-history-summary';
    const correct=results.filter(x=>x.correct).length;
    heading.textContent=results.length+' answers · '+correct+' correct · '+(results.length-correct)+' wrong';
    list.append(heading);
    if(!results.length){
      const empty=document.createElement('p');empty.className='study-empty';
      empty.textContent='No practice history yet. Swipe a Slide card to begin.';
      list.append(empty);
    }
    for(const item of results.slice(0,1000)){
      const row=document.createElement('div');row.className='slide-history-row';
      const mark=document.createElement('span');
      mark.className=item.correct?'slide-result-correct':'slide-result-wrong';
      mark.textContent=item.correct?'✓ Correct':'× Wrong';
      const word=document.createElement('strong');word.textContent=item.word||'';
      const meaning=document.createElement('span');meaning.textContent=item.meaning||'';
      const timestamp=document.createElement('small');
      timestamp.textContent=item.at?new Date(item.at).toLocaleString():'';
      row.append(mark,word,meaning,timestamp);
      const savedDeck=read(key('slide.deck.v2'),{}).cards||[];
      const fallback=savedDeck.find(x=>String(x.id)===String(item.id));
      const example=item.sentence||(fallback?.sentence?.replace('____',fallback.word))||'';
      const definition=item.definition||fallback?.definition||'';
      if(example){
        const sentence=document.createElement('p');sentence.className='slide-history-sentence';
        sentence.textContent=example;row.append(sentence);
      }
      if(definition){
        const detail=document.createElement('div');detail.className='slide-history-definition';
        detail.textContent=definition;row.append(detail);
      }
      const audio=document.createElement('div');audio.className='slide-history-audio';
      const playWord=createPlay('Listen to word: '+(item.word||''),item.word||'');
      playWord.textContent='🎧 Word';
      audio.append(playWord);
      if(example){
        const playSentence=createPlay('Listen to sentence',example);
        playSentence.textContent='🎧 Sentence';audio.append(playSentence);
      }
      row.append(audio);list.append(row);
    }
    dialog.showModal();
  }
  $('slideHistoryButton').addEventListener('click',openSlideHistory);
  $('slideHistoryClose').addEventListener('click',()=>$('slideHistoryDialog').close());
  $('slideHistoryDialog').addEventListener('click',ev=>{
    if(ev.target===$('slideHistoryDialog'))ev.target.close();
  });
  $('slideWordsButton').addEventListener('click',()=>openWordLibrary('slide'));
  $('newsWordsButton').addEventListener('click',()=>openWordLibrary('news'));
  $('studyWordsClose').addEventListener('click',()=>$('studyWordsDialog').close());
  $('studyWordsDialog').addEventListener('click',e=>{if(e.target===$('studyWordsDialog'))e.target.close()});

  function saveNewsWords(words,articleId){
    const existing=newsWords(),known=new Set(existing.map(w=>String(w.word||'').toLocaleLowerCase()));
    let changed=false;
    for(const w of words){
      if(!w?.word||!w.english)continue;
      const normalized=String(w.word).toLocaleLowerCase();
      if(known.has(normalized))continue;
      existing.push({...w,articleId,at:new Date().toISOString()});
      known.add(normalized);changed=true;
    }
    if(changed)store(key('news.words'),existing.slice(-800));
  }
  function addNewsWords(article) {saveNewsWords(article.words||[],article.id);}
  function renderNews() {
    const lang=getLanguage(),today=safeDate();
    if(newsLang!==lang){
      stopNews();newsLang=lang;newsReaderIndex=-1;archiveStory=null;
      const saved=read(key('news.daily.magazine.v6',lang),null);
      const previous=read(key('news.daily.long.v3',lang),null);
      if(previous?.stories?.length)saveNewsArchive(previous.stories);
      if(saved?.stories?.length)saveNewsArchive(saved.stories);
      newsData=saved?.stories?.length?saved:null;
    }
    const stories=$('newsStoryList');
    stories.replaceChildren();
    if(archiveStory) {renderNewsReader();return;}
    if(!newsData?.stories?.length){
      $('newsReader').hidden=true;
      info('newsStatus','Tap Update to prepare three magazine articles in '+({nl:'Dutch',fr:'French',en:'English'}[lang])+'.');
      return;
    }
    info('newsStatus',(new Date(newsData.updatedAt).toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'})===today&&!newsData.stale?'Articles · ':'Saved articles · ')+newsData.stories.length+' '+(newsData.stories.length===1?'article':'articles')+' · '+new Date(newsData.updatedAt).toLocaleDateString()+'.'+(newsData.partial?' Tap Update to check for more.':''));
    if(newsReaderIndex>=0&&newsReaderIndex<newsData.stories.length){renderNewsReader();return;}
    $('newsReader').hidden=true;stories.hidden=false;
    newsData.stories.forEach((story,index)=>{
      const btn=document.createElement('button');btn.type='button';btn.className='news-story-card';
      const meta=document.createElement('span');meta.className='news-card-meta';
      meta.textContent=(index+1)+' / '+newsData.stories.length+' · '+story.source+(story.publishedAt?' · '+new Date(story.publishedAt).toLocaleDateString():'');
      const h=document.createElement('strong');h.textContent=story.title;
      const count=(story.sentences||[]).reduce((sum,s)=>sum+String(s.target||'').trim().split(/\s+/).length,0);
      const sub=document.createElement('span');sub.textContent='Read & listen · About '+count+' words';
      btn.append(meta,h,sub);
      btn.addEventListener('click',()=>{newsReaderIndex=index;renderNewsReader();});
      stories.append(btn);
    });
  }
  async function updateNews(force=false) {
    const lang=getLanguage(),today=safeDate();
    const cached=read(key('news.daily.magazine.v6',lang),null);
    // One dated update per language per day. Reopening uses saved content.
    if(!force&&cached?.stories?.length&&new Date(cached.updatedAt).toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'})===today&&!cached.partial&&!cached.stale){
      saveNewsArchive(cached.stories||[]);
      newsData=cached;newsLang=lang;newsReaderIndex=-1;archiveStory=null;renderNews();return;
    }
    $('newsUpdateButton').disabled=true;info('newsStatus','Compiling three full-length articles from open magazine sources…');
    try{
      const resp=await fetch('/study-news?language='+encodeURIComponent(lang)+(force?'&refresh=1':''),{cache:'no-store',signal:AbortSignal.timeout(110000)});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data?.error||'Articles unavailable');
      if(!Array.isArray(data.stories)||data.stories.length===0)throw new Error('No articles in update');
      store(key('news.daily.magazine.v6',lang),data);
      if(lang===getLanguage()){
        saveNewsArchive(data.stories);
        newsData=data;newsLang=lang;newsReaderIndex=-1;archiveStory=null;renderNews();
      }
    }catch(error){
      info('newsStatus',(newsData?.stories?.length?'Could not refresh; saved stories remain available. ':'')+String(error.message||'Article update could not finish'));
    }
    finally{$('newsUpdateButton').disabled=false;}
  }
  $('newsUpdateButton').addEventListener('click',()=>void updateNews(true));
  $('newsArticlesButton').addEventListener('click',()=>{stopNews();archiveStory=null;newsReaderIndex=-1;renderNews();});
  $('newsBackButton').addEventListener('click',()=>{
    stopNews();newsReaderIndex=-1;archiveStory=null;renderNews();
  });
  function openNewsArchive(){
    stopNews();
    const dialog=$('newsHistoryDialog'),list=$('newsHistoryList');
    list.replaceChildren();
    const history=newsArchive();
    if(!history.length){
      const empty=document.createElement('p');empty.textContent='No saved articles yet. Tap Update to prepare your first articles.';
      list.append(empty);
    }
    history.forEach(story=>{
      const button=document.createElement('button');button.type='button';
      button.className='news-history-item';
      const heading=document.createElement('strong');heading.textContent=story.title;
      const meta=document.createElement('span');meta.textContent=
        (story.source||'News')+' · '+new Date(story.publishedAt||story.archivedAt||Date.now()).toLocaleDateString();
      button.append(heading,meta);
      button.addEventListener('click',()=>{
        dialog.close();stopNews();archiveStory=story;newsReaderIndex=-1;
        renderNewsReader();
      });
      list.append(button);
    });
    dialog.showModal();
  }
  $('newsHistoryButton').addEventListener('click',openNewsArchive);
  $('newsHistoryClose').addEventListener('click',()=>$('newsHistoryDialog').close());
  $('newsHistoryDialog').addEventListener('click',e=>{
    if(e.target===$('newsHistoryDialog'))e.target.close();
  });
  function renderNewsReader() {
    const article=currentArticle();if(!article)return;
    wordLookupSeq++;
    info('newsStatus',archiveStory
      ? 'Article History · Saved reading · Replay or select words'
      : 'Today\'s lesson · Select a sentence or press Run');
    $('newsStoryList').hidden=true;
    const reader=$('newsReader');reader.hidden=false;
    info('newsReaderTitle',article.title);
    const source=$('newsReaderSource');source.replaceChildren();
    const name=document.createElement('span');
    name.textContent=(article.sources?.length?'Sources: ':'Source: ')+article.source+
      (article.publishedAt?' · '+new Date(article.publishedAt).toLocaleDateString():'')+' · ';
    source.append(name);
    const links=article.sources?.length?article.sources:[{name:'Original article',url:article.url}];
    links.forEach((item,index)=>{
      if(index)source.append(document.createTextNode(' · '));
      const link=document.createElement('a');
      link.textContent=item.name||'Original article';
      link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
      source.append(link);
    });
    addNewsWords(article);
    info('newsNarrationDisclosure',article.kind==='article'
      ?'Original magazine-style learning article · Natural AI narration · Select any word to study'
      : 'Saved reading · Tap a word for its meaning');
    $('newsCompleteButton').hidden=!article.sentences.some(s=>s.english);
    const vocab=$('newsReaderWords');vocab.replaceChildren();
    for(const w of article.words){
      const item=document.createElement('div');item.className='news-vocab-item';
      const btn=document.createElement('button');btn.type='button';btn.className='news-vocab-detail-button';
      const first=document.createElement('strong');first.textContent=w.word;
      const en=document.createElement('span');en.textContent=w.english;
      btn.append(first,en);btn.title='Show explanation and example for '+w.word;
      btn.addEventListener('click',()=>{
        const sentenceIndex=article.sentences.findIndex(x=>
          x.target.toLocaleLowerCase().includes(w.word.toLocaleLowerCase()));
        void showNewsWordDetails(w.word,Math.max(0,sentenceIndex),0);
      });
      const audio=createPlay('Hear '+w.word,w.word);
      item.append(btn,audio);vocab.append(item);
    }
    stopNews();resumeAudioTime=null;speechIndex=0;speechOffset=0;wordHighlight=-1;
    $('newsWordDetail').hidden=true;
    $('newsAudioControls').hidden=true;
    $('newsAudioControls').classList.remove('manual-playback');
    renderArticleText(article);
    info('newsReadEnglish',getLanguage()==='en'?'':(article.sentences[0]?.english||''));
    $('newsRunButton').textContent='▶ Run';
    $('newsPauseButton').textContent='Stop';
    $('newsCompleteButton').setAttribute('aria-pressed',String(completeNews));
    $('newsCompleteButton').textContent=completeNews?'Focused text':'Complete text';
    updateNewsSeek();
  }
  const stripToken=text=>String(text||'')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLocaleLowerCase(locale[getLanguage()]||'en');
  let focusedWord=null,focusedSentence=0,focusedChar=0;
  async function showNewsWordDetails(token,sentenceIndex,charStart){
    const article=currentArticle();if(!article)return;
    stopNews();
    focusedSentence=sentenceIndex;focusedChar=charStart;
    const word=String(token||'').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
    if(!word)return;
    const panel=$('newsWordDetail');panel.hidden=false;
    focusedWord=word;
    info('newsWordTitle',word);
    info('newsWordMeaning','Loading English meaning…');
    info('newsWordDefinition','');
    info('newsWordExample','');
    const seq=++wordLookupSeq;
    const fromArticle=article.words?.find(x=>stripToken(x.word)===stripToken(word));
    let data=fromArticle;
    if(!data){
      const cache=read(key('news.lookup'),{});
      const cacheKey=(article.id||'article')+'|'+sentenceIndex+'|'+stripToken(word);
      data=cache[cacheKey];
      if(!data){
        try {
          const response=await fetch('/study-news-word',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({language:getLanguage(),word,
              sentence:article.sentences[sentenceIndex]?.target||''})
          });
          const result=await response.json();
          if(!response.ok)throw new Error(result.error||'Unable to explain this word.');
          data=result;
          cache[cacheKey]=data;store(key('news.lookup'),cache);
        }catch(error){
          if(seq===wordLookupSeq){
            info('newsWordMeaning',String(error?.message||'Explanation unavailable.'));
            info('newsWordDefinition','Try selecting another word or retry.');
          }
          return;
        }
      }
    }
    if(seq!==wordLookupSeq||focusedWord!==word||currentPage!=='news')return;
    info('newsWordMeaning','English: '+data.english);
    info('newsWordDefinition',data.definition);
    info('newsWordExample',data.example);
    // Every studied word — including one selected directly in an article —
    // becomes available for later review in News Words.
    saveNewsWords([{...data,word}],article.id);
    $('newsWordPlay').onclick=()=>say(word);
    $('newsExamplePlay').onclick=()=>say(data.example);
    $('newsWordFromHere').onclick=()=>seekNews(sentenceIndex,charStart,true);
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  $('newsWordClose').addEventListener('click',()=>{$('newsWordDetail').hidden=true;wordLookupSeq++;});
  function renderArticleText(article) {
    const target=$('newsReadTarget');target.replaceChildren();
    const paragraphSize=5;
    let paragraph=null;
    article.sentences.forEach((sentence,i)=>{
      if(i%paragraphSize===0){
        paragraph=document.createElement('p');
        paragraph.className='news-paper-paragraph';
        target.append(paragraph);
      }
      const line=document.createElement('span');line.className='news-sentence';
      line.dataset.sentence=String(i);
      if(i===speechIndex)line.classList.add('active-sentence');
      // A continuous newspaper paragraph: sentences sit inline, not as rows.
      line.addEventListener('click',()=>seekNews(i,0,true));
      const tokens=sentence.target.split(/(\s+)/);let pos=0;
      for(const token of tokens){
        if(!token)continue;
        if(/^\s+$/.test(token)){
          line.append(document.createTextNode(token));pos+=token.length;continue;
        }
        const span=document.createElement('span');span.className='news-token';
        span.textContent=token;span.dataset.charStart=String(pos);
        span.tabIndex=0;span.setAttribute('role','button');
        span.setAttribute('aria-label','Explain word '+token);
        if(i===speechIndex&&pos<=wordHighlight&&wordHighlight<pos+token.length)
          span.classList.add('speaking');
        const at=pos;
        span.addEventListener('click',ev=>{ev.stopPropagation();void showNewsWordDetails(token,i,at)});
        span.addEventListener('keydown',ev=>{
          if(ev.key==='Enter'||ev.key===' '){
            ev.preventDefault();ev.stopPropagation();void showNewsWordDetails(token,i,at);
          }
        });
        line.append(span);pos+=token.length;
      }
      paragraph.append(line);
      paragraph.append(document.createTextNode(' '));
      if(completeNews && getLanguage()!=='en' &&
        ((i+1)%paragraphSize===0 || i===article.sentences.length-1)){
        const from=Math.floor(i/paragraphSize)*paragraphSize;
        const english=document.createElement('p');
        english.className='news-complete-english';
        english.textContent=article.sentences.slice(from,i+1).map(x=>x.english).join(' ');
        target.append(english);
      }
    });
  }
  $('newsCompleteButton').addEventListener('click',()=>{
    completeNews=!completeNews;
    $('newsCompleteButton').setAttribute('aria-pressed',String(completeNews));
    $('newsCompleteButton').textContent=completeNews?'Focused text':'Complete text';
    const article=currentArticle();if(article)renderArticleText(article);
  });
  function setSpeechIndex(i,word=-1) {
    const story=currentArticle();if(!story)return;
    speechIndex=i;wordHighlight=word;
    const lines=[...$('newsReadTarget').querySelectorAll('.news-sentence')];
    lines.forEach((line,n)=>{
      line.classList.toggle('active-sentence',n===i);
      for(const token of line.querySelectorAll('.news-token')) {
        const pos=Number(token.dataset.charStart);
        token.classList.toggle('speaking',n===i&&word>=pos&&word<pos+token.textContent.length);
      }
    });
    info('newsReadEnglish',getLanguage()==='en'?'':(story.sentences[i]?.english||''));
    updateNewsSeek();
    if(lines[i] && !lines[i].dataset.wasActive){
      lines.forEach(line=>{delete line.dataset.wasActive;});
      lines[i].dataset.wasActive='1';
      lines[i].scrollIntoView({block:'nearest',behavior:'smooth'});
    }
  }
  function seekNews(index,offset=0,autoplay=true){
    const story=currentArticle();
    if(!story?.sentences?.length)return;
    stopNews();resumeAudioTime=null;
    speechIndex=Math.max(0,Math.min(story.sentences.length-1,index));
    speechOffset=Math.max(0,Math.min(story.sentences[speechIndex].target.length-1,offset));
    setSpeechIndex(speechIndex,speechOffset);
    $('newsWordDetail').hidden=true;
    if(autoplay)startNews();
  }
  function newsAudioPositions(article){
    const weights=article.sentences.map(item=>Math.max(4,item.target.length));
    const total=weights.reduce((a,b)=>a+b,0);
    let sum=0;
    return weights.map(weight=>{const position=sum/total;sum+=weight;return {start:position,length:weight/total};});
  }
  function timeForNews(index,offset,article,duration){
    const positions=newsAudioPositions(article);
    const row=positions[index]||positions[0];
    if(!row)return 0;
    const len=Math.max(1,article.sentences[index]?.target.length||1);
    return Math.max(0,Math.min(duration-.15,
      duration*(row.start+row.length*Math.max(0,offset)/len)));
  }
  function followNewsAudio(){
    if(!newsAudioActive||!newsPlaying||!Number.isFinite(newsAudio.duration)||newsAudio.duration<=0)return;
    const article=currentArticle();if(!article)return;
    const percent=Math.max(0,Math.min(.999,newsAudio.currentTime/newsAudio.duration));
    const ranges=newsAudioPositions(article);
    let i=ranges.findIndex((r,n)=>percent>=r.start && (n===ranges.length-1||percent<r.start+r.length));
    if(i<0)i=ranges.length-1;
    const row=ranges[i];
    const offset=Math.floor((percent-row.start)/Math.max(.00001,row.length)*
      article.sentences[i].target.length);
    speechOffset=Math.max(0,offset);
    setSpeechIndex(i,speechOffset);
  }
  const newsSeek=$('newsSeekRange');
  const shortTime=seconds=>{
    const s=Math.max(0,Math.floor(Number(seconds)||0));
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  };
  function updateNewsSeek(){
    const story=currentArticle();
    if(!story?.sentences?.length||newsScrubbing)return;
    const ranges=newsAudioPositions(story);
    const i=Math.max(0,Math.min(story.sentences.length-1,speechIndex));
    const part=Math.min(1,Math.max(0,speechOffset/Math.max(1,story.sentences[i].target.length)));
    const pct=speechIndex>=story.sentences.length?1:Math.min(1,(ranges[i]?.start||0)+(ranges[i]?.length||0)*part);
    newsSeek.value=String(Math.round(1000*pct));
    info('newsSeekLabel',Number.isFinite(newsAudio.duration)&&newsAudio.duration>0&&activeAudioId.includes(story.id)
      ? shortTime(pct*newsAudio.duration)+' / '+shortTime(newsAudio.duration)
      : Math.round(pct*100)+'%');
  }
  function seekSpot(fraction){
    const story=currentArticle(),ranges=story?newsAudioPositions(story):[];
    if(!ranges.length)return {i:0,offset:0};
    const percent=Math.max(0,Math.min(.999999,fraction));
    let i=ranges.findIndex((r,n)=>percent>=r.start&&(n===ranges.length-1||percent<r.start+r.length));
    if(i<0)i=ranges.length-1;
    const row=ranges[i];
    const offset=Math.floor(Math.max(0,(percent-row.start)/Math.max(.00001,row.length))*
      Math.max(1,story.sentences[i].target.length-1));
    return {i,offset};
  }
  newsSeek.addEventListener('input',()=>{
    newsScrubbing=true;
    const value=Number(newsSeek.value)/1000;
    const spot=seekSpot(value);
    setSpeechIndex(spot.i,spot.offset);
    info('newsSeekLabel',Math.round(value*100)+'%');
  });
  newsSeek.addEventListener('change',()=>{
    const value=Number(newsSeek.value)/1000;
    newsScrubbing=false;
    const spot=seekSpot(value);
    seekNews(spot.i,spot.offset,newsPlaying);
    updateNewsSeek();
  });
  newsAudio.addEventListener('play',()=>{
    newsAudioActive=true;newsPlaying=true;
    $('newsRunButton').textContent='■ Stop';
    $('newsPauseButton').textContent='Stop';
  });
  newsAudio.addEventListener('timeupdate',followNewsAudio);
  newsAudio.addEventListener('seeking',followNewsAudio);
  newsAudio.addEventListener('ended',()=>{
    newsPlaying=false;newsAudioActive=false;
    $('newsRunButton').textContent='▶ Replay';
    $('newsPauseButton').textContent='Continue';
    const article=currentArticle();
    if(article){speechIndex=article.sentences.length;speechOffset=0;resumeAudioTime=null;updateNewsSeek();}
  });
  newsAudio.addEventListener('pause',()=>{
    if(newsAudioActive&&newsPlaying&&newsAudio.currentTime<newsAudio.duration){
      newsPlaying=false;newsAudioActive=false;
      $('newsRunButton').textContent='▶ Continue';
      $('newsPauseButton').textContent='Continue';
    }
  });
  async function playNaturalNews(seq){
    const article=currentArticle();
    if(!article)throw new Error('No article selected');
    const fullText=article.sentences.map(x=>x.target.trim()).join(' ').slice(0,6200);
    if(fullText.length<60)throw new Error('News text missing');
    const id=getLanguage()+':'+article.id+':'+fullText.length+':'+fullText.slice(0,22);
    if(activeAudioId!==id||!newsAudio.src){
      let url=newsAudioCache.get(id);
      if(!url){
        info('newsStatus','Preparing a natural article narration…');
        const response=await fetch('/study-news-audio',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({storyId:article.id,language:getLanguage(),text:fullText})
        });
        if(!response.ok){
          const error=await response.json().catch(()=>({}));
          throw new Error(error?.error||'Natural narration unavailable');
        }
        const bytes=await response.blob();
        if(bytes.size<1200)throw new Error('Empty news narration');
        url=URL.createObjectURL(bytes);
        newsAudioCache.set(id,url);
        if(newsAudioCache.size>12){
          for(const [key,value] of [...newsAudioCache].slice(0,-10)){
            if(key!==id){newsAudioCache.delete(key);URL.revokeObjectURL(value);}
          }
        }
      }
      if(seq!==speechSeq || !newsPlaying)return;
      newsAudio.pause();newsAudio.src=url;activeAudioId=id;
      newsAudio.load();
    }
    if(!Number.isFinite(newsAudio.duration)||newsAudio.duration===0){
      await new Promise((resolve,reject)=>{
        if(newsAudio.readyState>=1&&Number.isFinite(newsAudio.duration))return resolve();
        const timeout=setTimeout(()=>reject(new Error('News audio loading timed out')),15000);
        const ready=()=>{clearTimeout(timeout);newsAudio.removeEventListener('error',failed);resolve()};
        const failed=()=>{clearTimeout(timeout);newsAudio.removeEventListener('loadedmetadata',ready);reject(new Error('News audio failed'))};
        newsAudio.addEventListener('loadedmetadata',ready,{once:true});
        newsAudio.addEventListener('error',failed,{once:true});
      });
    }
    if(seq!==speechSeq||!newsPlaying)return;
    newsAudio.currentTime=resumeAudioTime!==null ? Math.min(Math.max(0,resumeAudioTime),newsAudio.duration-.1) : timeForNews(speechIndex,speechOffset,article,newsAudio.duration);
    resumeAudioTime=null;
    newsAudioActive=true;
    $('newsAudioControls').hidden=false;
    try {
      await newsAudio.play();
      $('newsAudioControls').hidden=true;
      $('newsAudioControls').classList.remove('manual-playback');
    }catch(error){
      newsPlaying=false;newsAudioActive=false;
      $('newsAudioControls').classList.add('manual-playback');
      $('newsAudioControls').hidden=false;
      info('newsStatus','AI audio is ready. Tap Play on the audio player to start listening.');
      $('newsRunButton').textContent='▶ Continue';
      return;
    }
    info('newsStatus','Natural article narration · Tap any word for explanation');
  }
  function startNews(){
    const story=currentArticle();if(!story)return;
    if(speechIndex>=story.sentences.length){speechIndex=0;speechOffset=0;}
    newsPlaying=true;newsPaused=false;
    const seq=++speechSeq;
    window.speechSynthesis?.cancel?.();
    $('newsRunButton').textContent='■ Stop';
    $('newsPauseButton').textContent='Stop';
    if(story.kind==='rss'){
      info('newsStatus','Reading with your device voice.');
      speakCurrent(seq);
      return;
    }
    void playNaturalNews(seq).catch(error=>{
      if(seq!==speechSeq || !newsPlaying)return;
      newsAudioActive=false;
      $('newsAudioControls').hidden=true;
      console.warn('Natural narration not available, using device speech:',error);
      info('newsStatus','Using device speech (natural voice temporarily unavailable).');
      speakCurrent(seq);
    });
  }
  function speakCurrent(seq){
    if(seq!==speechSeq||!newsPlaying)return;
    const story=currentArticle();
    if(!story||speechIndex>=story.sentences.length){stopNews();return;}
    if(!window.speechSynthesis){
      info('newsStatus','Speech playback is not available in this browser.');
      stopNews();return;
    }
    const fullSentence=story.sentences[speechIndex].target;
    const offset=Math.max(0,Math.min(fullSentence.length-1,speechOffset));
    const sentence=fullSentence.slice(offset);
    setSpeechIndex(speechIndex,offset);
    const utterance=new SpeechSynthesisUtterance(sentence);
    utterance.lang=locale[getLanguage()]||'nl-BE';utterance.rate=.84;
    if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
    let sawWordBoundary=false;
    const words=[...sentence.matchAll(/\S+/g)].map(x=>x.index+offset);
    let estimatedWord=0;
    newsHighlightTimer=setInterval(()=>{
      if(seq!==speechSeq||!newsPlaying){
        clearInterval(newsHighlightTimer);newsHighlightTimer=null;return;
      }
      if(sawWordBoundary)return;
      if(estimatedWord<words.length){
        speechOffset=words[estimatedWord++];
        setSpeechIndex(speechIndex,speechOffset);
      }
    },430);
    utterance.onboundary=event=>{
      if(seq!==speechSeq)return;
      sawWordBoundary=true;
      if(event.name==='word'||typeof event.charIndex==='number'){
        speechOffset=offset+event.charIndex;
        setSpeechIndex(speechIndex,speechOffset);
      }
    };
    utterance.onend=()=>{
      if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
      if(seq!==speechSeq||!newsPlaying)return;
      speechIndex++;speechOffset=0;
      if(speechIndex<story.sentences.length)speakCurrent(seq);
      else {
        stopNews();speechIndex=story.sentences.length-1;
        speechOffset=0;$('newsRunButton').textContent='▶ Replay';
        $('newsPauseButton').textContent='Continue';
      }
    };
    utterance.onerror=event=>{
      if(newsHighlightTimer){clearInterval(newsHighlightTimer);newsHighlightTimer=null;}
      if(seq===speechSeq){
        info('newsStatus','Playback stopped. Select a sentence or tap Continue.');
        stopNews();
      }
    };
    window.speechSynthesis.speak(utterance);
  }
  $('newsRunButton').addEventListener('click',()=>{
    if(newsPlaying)stopNews();else startNews();
  });
  $('newsPauseButton').addEventListener('click',()=>{
    if(newsPlaying)stopNews();else startNews();
  });
  $('newsPrevButton').addEventListener('click',()=>seekNews(Math.max(0,speechIndex-1),0,newsPlaying));
  $('newsNextButton').addEventListener('click',()=>{
    const story=currentArticle();if(!story)return;
    seekNews(Math.min(story.sentences.length-1,speechIndex+1),0,newsPlaying);
  });
  function refreshLanguage(){
    stopNews();media.refreshLanguage();
    if(currentPage==='slide'){cards=[];cardIndex=0;void loadSlide();}
    if(currentPage==='news'){
      newsLang='';newsReaderIndex=-1;archiveStory=null;renderNews();
      if(!newsData?.stories?.length||new Date(newsData.updatedAt).toLocaleDateString('sv-SE',{timeZone:'Europe/Brussels'})!==safeDate())void updateNews();
    }
  }
  return {refreshLanguage,stopNews,getPage:()=>currentPage,openNewsArchive,
    openSlideHistory,openWordLibrary};
}
