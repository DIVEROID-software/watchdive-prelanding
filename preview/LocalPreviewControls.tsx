import { useEffect, useState } from "react";
import { previewState, previewVerify } from "./mock-api";

/** Development controls only; the complete landing page below is the real route. */
export function LocalPreviewControls() {
  const [state,setState] = useState({pending:false,verified:false});
  useEffect(()=>{
    const update=()=>setState(previewState());
    window.addEventListener("wd:local-preview-state", update); update();
    return ()=>window.removeEventListener("wd:local-preview-state", update);
  },[]);
  return <aside data-local-preview="" style={{position:"sticky",top:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:8,width:"100%",padding:"6px 12px",background:"#fff3cd",color:"#201748",fontFamily:"sans-serif",fontSize:10,lineHeight:1.5}}>
    <strong>로컬 검토용</strong><span>실제 가입·메일·결제 없음</span>
    {state.pending&&!state.verified&&<button type="button" style={{border:0,padding:"6px 10px",background:"#3d2683",color:"white",cursor:"pointer"}} onClick={previewVerify}>테스트 이메일 인증하기</button>}
    {state.verified&&<span>테스트 인증 완료</span>}
  </aside>;
}
