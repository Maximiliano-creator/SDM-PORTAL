function u(s,t){if(t.length===0)return;const o=Object.keys(t[0]),l=n=>{if(n==null)return"";const e=String(n);return e.includes(",")||e.includes('"')||e.includes(`
`)?`"${e.replace(/"/g,'""')}"`:e},i=[o.join(","),...t.map(n=>o.map(e=>l(n[e])).join(","))],a=new Blob(["\uFEFF"+i.join(`\r
`)],{type:"text/csv;charset=utf-8"}),r=URL.createObjectURL(a),c=document.createElement("a");c.href=r,c.download=s,c.click(),URL.revokeObjectURL(r)}export{u as d};
