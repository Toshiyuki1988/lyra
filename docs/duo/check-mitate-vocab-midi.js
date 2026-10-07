(function () {
  if (window.__mitateMidiCheck) return; window.__mitateMidiCheck = true;
  const V = LyraMitate, E = LyraEngine, M = LyraMidi, D = LyraDesign;
  const entries = [V.SEED[0], ...Object.values(LyraMitateGen.TEXTURE_EXAMPLES).flat().filter((e) => ['霜の花', '鳥居をくぐる', '風鈴の最後の一打', '池の氷が鳴る', '境内の砂利'].includes(e.name))]
    .map((e, i) => ({ ...e, id: e.id || `check-${i}`, tone: '神秘' }));
  const originalGet = E.vocab.get;
  E.vocab.get = (key) => {
    const e = entries.find((x) => x.id === key);
    if (!e) return originalGet(key);
    const notes = e.parts.filter((p) => p.tones !== false).flatMap((p) => p.notes.map(([name, t, d, v]) => [LyraTheory.noteToMidi(name), t, d, v]));
    return { id: e.id, name: e.name, tone: e.tone, notes, parts: V.sanitizeParts(e.parts), len: Math.max(...e.parts.flatMap((p) => p.notes.map((n) => n[1]+n[2]))) };
  };
  const select = document.querySelector('#entry');
  entries.forEach((e) => select.add(new Option(e.name, e.id)));
  let card, handle, saved, muted=false, solo=false;
  const result = (s) => document.querySelector('#results').textContent += s + '\n';
  function makeCard(e) {
    const layer = D.sanitizeLayer({ generator:'mitate', vocab:e.id, occurrence:'once', name:e.name }, 64, ['mitate']);
    const design={tempo:72,bars:8,meters:[{bar:1,num:4,den:4}],swing:0,pitch:{system:'free',root:2,scale:'lydian',modulations:[]},layers:[layer]};
    return {id:'check',name:e.name+'.mid',voice:'lyra_mu',midi:{...E.render(design,{seed:42}),design}};
  }
  function reset(){M.stopAll();card=makeCard(entries.find((e)=>e.id===select.value)); window.testCard=card;muted=solo=false;setStatus('準備完了: '+card.name);}
  select.onchange=reset; reset();
  document.querySelector('#play').onclick=async()=>{await M.togglePlay(card);setStatus('試聴中');};
  document.querySelector('#stop').onclick=()=>{M.stopAll();if(handle)handle.stop();setStatus('停止');};
  const rerender=()=>{M.stopAll(); const d=card.midi.design;card.midi={...E.render(d,{seed:42}),design:d};};
  document.querySelector('#mute').onclick=()=>{muted=!muted;card.midi.design.layers[0].muted=muted;rerender();setStatus(muted?'消音':'鳴らす');};
  function backing(){return {generator:'line',name:'確認用の伴奏',role:'bass',active:[],notes:[{pitch:48,start:0,duration:16,velocity:60}]};}
  document.querySelector('#solo').onclick=()=>{solo=!solo;const d=card.midi.design;d.layers[0].muted=false;if(!d.layers[1])d.layers.push(backing());d.layers[1].muted=solo;rerender();setStatus(solo?'語彙をソロ':'ソロ解除: 伴奏も鳴る');};
  document.querySelector('#edit').onclick=()=>{if(card.midi.notes[0])card.midi.notes[0].pitch++;setStatus('音符を編集: 原音ではなく共通三層で再生');};
  document.querySelector('#save').onclick=()=>{saved=JSON.stringify(card);card=JSON.parse(saved);window.testCard=card;setStatus('模擬Drive JSONを保存→読込: '+saved.length+'文字');};
  document.querySelector('#remove').onclick=()=>{E.vocab.get=()=>null;rerender();setStatus('帳を空にして同じ設計図から振り直し');};
  document.querySelector('#wav').onclick=()=>M.exportWav(card);
  document.querySelector('#mid').onclick=()=>{const bytes=M.buildSmf(card,'merged');M.downloadBlob(new Blob([bytes]),card.name);setStatus(card.name+'のMIDIデータを生成: '+bytes.length+' bytes、'+bytes[11]+'トラック');};
  const peak=(a)=>a.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
  const db=(x)=>20*Math.log10(Math.max(1e-12,x));
  const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
  async function direct(e, event, duration, gain=1) {
    const ctx=new OfflineAudioContext(1,Math.ceil(duration*44100),44100);
    V.scheduleMu(ctx,e,M.beatToSeconds(card.midi)(event.beat),{dest:ctx.destination,gain:gain*event.lift,shift:event.shift});
    return (await ctx.startRendering()).getChannelData(0);
  }
  // OfflineAudioContextの録音先を使い、試聴側の接続(safeOut・previewMaster)も数値で検証。
  async function previewBuffer(source, stopAt) {
    const audio=new OfflineAudioContext(1,Math.ceil(40*44100),44100);
    const facade={sampleRate:audio.sampleRate,currentTime:0,destination:audio.destination};
    ['createGain','createBiquadFilter','createOscillator','createBuffer','createBufferSource'].forEach((k)=>facade[k]=audio[k].bind(audio));
    const h=await M.scheduleVoiced(facade,source,0);
    if(stopAt) h.stop();
    return (await audio.startRendering()).getChannelData(0);
  }
  document.querySelector('#test').onclick=async function () {
    if(this.disabled)return;this.disabled=true;document.querySelector('#results').textContent='';
    try {
      for(const entry of entries){
        card=makeCard(entry);window.testCard=card;
        const event=card.midi.mu[0], calls=safeCalls;
        const buffer=await M.renderBuffer(card);const actual=buffer.getChannelData(0);
        ensure(safeCalls===calls,'WAVがsafeOutを通った');
        const expected=await direct(entry,event,buffer.duration,0.8);
        const p=peak(actual),q=peak(expected),diff=db(p)-db(q);
        ensure(Math.abs(diff)<0.1,'原音の波形の音量差');
        let err=0,errAt=0;for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-expected[i])>err){err=Math.abs(actual[i]-expected[i]);errAt=i;}
        ensure(err<0.0001,'波形不一致 '+entry.name+' '+err+' at '+(errAt/44100)+' actual '+actual[errAt]+' expected '+expected[errAt]+' event '+JSON.stringify(event));
        const windowAudio=await direct(entry,event,buffer.duration);
        ensure(Math.abs(db(p)-db(peak(windowAudio)))<=3,'窓との音量差が3dB超');
        const legacy=JSON.parse(JSON.stringify(card));delete legacy.midi.design.layers[0].vocabParts;legacy.midi.mu=[];
        const old=await M.renderBuffer(legacy);const oldDb=db(peak(old.getChannelData(0)));
        result('PASS '+entry.name+': 原音との波形最大差 '+err.toExponential(2)+'、WAV '+db(p).toFixed(2)+' dBFS / 窓 '+db(peak(windowAudio)).toFixed(2)+' / 旧音色 '+oldDb.toFixed(2));
        if(entry.name==='夜道の月光')ensure(Math.abs(db(p)-oldDb)<=3,'旧音色との音量差が3dB超');
        const json=JSON.parse(JSON.stringify(card));ensure(JSON.stringify(json.midi.design.layers[0].vocabParts)===JSON.stringify(card.midi.design.layers[0].vocabParts),'JSONの音の写し');
        if(entry.name==='鳥居をくぐる'){
          const start=M.beatToSeconds(card.midi)(event.beat);let silent=0;
          for(let i=Math.ceil((start+2)*44100);i<Math.floor((start+2.8)*44100);i++)silent=Math.max(silent,Math.abs(actual[i]));
          ensure(silent<0.00001,'無音が埋まった');result('PASS 鳥居の途中0.8秒の無音: '+db(silent).toFixed(1)+' dBFS');
        }
        const g=document.querySelector('#wave').getContext('2d');g.clearRect(0,0,1000,150);g.beginPath();
        for(let x=0;x<1000;x++){const v=actual[Math.floor(x*actual.length/1000)];g.lineTo(x,75-v*250);}g.stroke();
      }
      card=makeCard(entries[0]);const base=await M.renderBuffer(card),before=safeCalls;
      const preview=await previewBuffer(card);ensure(safeCalls>before,'試聴のsafeOut');
      ensure(Math.abs(db(peak(preview))-db(peak(base.getChannelData(0))))<0.05,'試聴とWAVの差');
      ensure(peak(await previewBuffer(card,true))===0,'停止後に語彙の音が残った');
      result('PASS 試聴: WAVと音量一致、safeOut経由、停止後は無音');
      const edited=JSON.parse(JSON.stringify(card));edited.voice='piano';edited.midi.notes[0].pitch++;
      const schedule=V.scheduleMu;let calls=0;V.scheduleMu=(...args)=>{calls++;return schedule(...args);};
      let editBuffer;try{editBuffer=await M.renderBuffer(edited);}finally{V.scheduleMu=schedule;}
      ensure(calls===0&&peak(editBuffer.getChannelData(0))>0,'編集した音符を共通音色で鳴らす');
      ensure(!new TextDecoder().decode(M.buildSmf(edited,'merged')).includes('・B'),'編集後のB');result('PASS 音符編集: 原音を予約せず共通三層で鳴り、Bは追加しない');
      const wav=new Uint8Array(await M.encodeWav(base).arrayBuffer());ensure(new TextDecoder().decode(wav.slice(0,4))==='RIFF'&&new TextDecoder().decode(wav.slice(8,12))==='WAVE','WAVファイルの形式');
      ensure(new TextDecoder().decode(M.buildSmf(card,'merged')).includes('夜道の月光・B'),'Bのトラック名');result('PASS 書き出し: RIFF/WAVE形式、MIDに語彙名・Bのトラック');
      const noiseDesign=JSON.parse(JSON.stringify(card.midi.design));noiseDesign.layers[0].vocabNotes=[];noiseDesign.layers[0].vocabLen=1;
      noiseDesign.layers[0].vocabParts=[{notes:[['C4',0,1,60]],tones:false,noise:{freq:1000,level:0.5},env:{a:0.01,r:0.1}}];
      const noiseCard={...card,midi:{...E.render(noiseDesign,{seed:42}),design:noiseDesign}};
      ensure(peak((await M.renderBuffer(noiseCard)).getChannelData(0))>0,'ノイズだけの原音');
      ensure(M.withVocabB(noiseCard.midi).notes.length===0,'ノイズがMIDの音符になった');result('PASS ノイズだけの層: WAVは鳴り、MIDにAもBも入らない');
      const ccCard=JSON.parse(JSON.stringify(card));ccCard.midi.cc=[{controller:11,points:[{beat:0,value:0}]}];
      const low=await M.renderBuffer(ccCard);const ccDb=db(peak(low.getChannelData(0)))-db(peak(base.getChannelData(0)));
      ensure(ccDb < -15,'CC11が語彙に効かない');result('PASS CC11: '+ccDb.toFixed(2)+' dB');
      ccCard.midi.cc[0].controller=7;ensure(peak((await M.renderBuffer(ccCard)).getChannelData(0))<peak(base.getChannelData(0))/5,'CC7');
      card.midi.design.layers[0].muted=true;const d=card.midi.design;const muteCard={...card,midi:{...E.render(d,{seed:42}),design:d}};
      ensure(peak((await M.renderBuffer(muteCard)).getChannelData(0))===0,'消音後に音が残った');
      result('PASS 消音: 無音、CC7も有効');
      const soloDesign=JSON.parse(JSON.stringify(makeCard(entries[0]).midi.design));soloDesign.layers.push({...backing(),muted:true});
      const soloCard={...makeCard(entries[0]),midi:{...E.render(soloDesign,{seed:42}),design:soloDesign}};
      ensure(Math.abs(peak((await M.renderBuffer(soloCard)).getChannelData(0))-peak(base.getChannelData(0)))<0.00001,'語彙のソロ');result('PASS ソロ: 伴奏を消して語彙だけの波形を維持');
      card=makeCard(entries[0]);const stored=JSON.parse(JSON.stringify(card));const get=E.vocab.get;E.vocab.get=()=>null;
      stored.midi={...E.render(stored.midi.design,{seed:42}),design:stored.midi.design};
      const savedBuffer=await M.renderBuffer(stored);E.vocab.get=get;
      ensure(Math.abs(peak(savedBuffer.getChannelData(0))-peak(base.getChannelData(0)))<0.00001,'帳から外して振り直し');
      result('PASS 保存→読込、帳から外して振り直し: 波形音量を維持');
      const shifted=makeCard(entries[1]);shifted.midi.design.pitch.root=7;shifted.midi.design.layers[0].register='low';
      shifted.midi={...E.render(shifted.midi.design,{seed:42}),design:shifted.midi.design};card=shifted;
      const shiftBuffer=await M.renderBuffer(shifted),expectedShift=await direct(entries[1],shifted.midi.mu[0],shiftBuffer.duration,0.8);
      ensure(Math.abs(peak(shiftBuffer.getChannelData(0))-peak(expectedShift))<0.00001,'移調');result('PASS G主音・低音域: '+shifted.midi.mu[0].shift+'半音');
      result('PASS: WAVはsafeOutを通らない。JSONの音の写しを維持。');setStatus('数値検証成功');
      const demo=LyraDemos.render('mitategura');
      const demoCard={id:'demo',name:'demo.mid',voice:'lyra_mu',midi:demo};
      const demoNew=await M.renderBuffer(demoCard);
      const demoOld=JSON.parse(JSON.stringify(demoCard));demoOld.midi.mu=[];demoOld.midi.design.layers.forEach((l)=>delete l.vocabParts);
      const legacyDemo=await M.renderBuffer(demoOld);
      const newDb=db(peak(demoNew.getChannelData(0))),oldDb=db(peak(legacyDemo.getChannelData(0)));
      ensure(Math.abs(newDb-oldDb)<=3,'お手本の旧音色との音量差');result('PASS お手本: 新 '+newDb.toFixed(2)+' / 旧 '+oldDb.toFixed(2)+' dBFS、差 '+(newDb-oldDb).toFixed(2)+' dB');
    }catch(err){result('FAIL '+err.stack);setStatus('数値検証失敗');}finally{this.disabled=false;card=makeCard(entries.find((e)=>e.id===select.value));window.testCard=card;muted=solo=false;}
  };
})();
