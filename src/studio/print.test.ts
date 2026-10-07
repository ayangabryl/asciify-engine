import { expect, it } from 'vitest';
import { createPrintPainter } from './print-renderer';
import { DEFAULT_STUDIO_PRINT, normalizeStudioPrint, STUDIO_PRINT_STYLES, STUDIO_PRINT_STYLE_IDS, type StudioPrintStyle } from './print-model';
import { normalizeStudioSettings, parseStudioSettings, serializeStudioSettings, studioGrid, updateStudioSettings } from './model';

function drawing(style: StudioPrintStyle, options: unknown = {}, tone = .65, cell = 10, mode: 'accent'|'source'|'gray' = 'accent') {
  const commands: (string|number)[][] = [];
  let area = 0, pathArea = 0, length = 0, points: [number,number][] = [];
  const ctx = {
    globalAlpha: 1, lineWidth: 1, fillStyle: '', strokeStyle: '', globalCompositeOperation: 'source-over',
    beginPath() { commands.push(['begin']);pathArea=0;length=0;points=[]; },
    moveTo(x:number,y:number) { commands.push(['move',x,y]);points=[[x,y]]; },
    lineTo(x:number,y:number) { commands.push(['line',x,y]);const previous=points.at(-1);if(previous)length+=Math.hypot(x-previous[0],y-previous[1]);points.push([x,y]); },
    closePath() { commands.push(['close']);let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a[0]*b[1]-a[1]*b[0];}pathArea+=Math.abs(sum)/2;points=[]; },
    arc(x:number,y:number,r:number) { commands.push(['arc',x,y,r]);pathArea+=Math.PI*r*r; },
    ellipse(x:number,y:number,a:number,b:number,angle:number) { commands.push(['ellipse',x,y,a,b,angle]);pathArea+=Math.PI*a*b; },
    fill() { commands.push(['fill',this.fillStyle,this.globalCompositeOperation]);area+=pathArea; },
    stroke() { commands.push(['stroke',this.strokeStyle,this.lineWidth]);area+=length*this.lineWidth; },
  };
  const painter=createPrintPainter(options);
  for(let y=0;y<4;y++)for(let x=0;x<5;x++)painter.paint(ctx as unknown as CanvasRenderingContext2D,style,x,y,x*cell,y*cell,cell,tone,'#547065',70,120,190,mode);
  return {commands,area,ctx};
}

it('bounds hostile print settings and keeps defaults independent',()=>{
  const p=normalizeStudioPrint({density:Infinity,weight:-1,angle:300,roughness:NaN,invert:'true',secondaryInk:'url(secret)',seed:-3,registration:9});
  expect(p).toEqual({...DEFAULT_STUDIO_PRINT,weight:.25,angle:180,seed:0,registration:1});
  p.density=0;expect(normalizeStudioPrint({}).density).toBe(1);
  expect(normalizeStudioSettings().style).toBe('ascii');
});
it.each(STUDIO_PRINT_STYLES)('$label preserves controls, partial updates and fine size through saved settings',({value:style})=>{
  const original=normalizeStudioSettings({style,cellSize:1,print:{invert:true,density:1.2,seed:18,secondaryInk:'#abcdef'}});
  const updated=updateStudioSettings(original,{print:{weight:1.6}});
  expect(updated.print).toEqual({...original.print,weight:1.6});
  expect(original.print?.weight).toBe(1);
  expect(parseStudioSettings(serializeStudioSettings(updated))).toEqual(updated);
  const small=studioGrid(120,80,updated,12000),large=studioGrid(480,320,updated,12000,4);
  expect(small.cell).toBe(1);expect(small.rowHeight).toBe(1);
  expect([small.columns,small.rows]).toEqual([large.columns,large.rows]);
});
it('uses six distinct command geometries instead of duplicated named presets',()=>{
  expect(STUDIO_PRINT_STYLES.map(style=>style.value)).toEqual(STUDIO_PRINT_STYLE_IDS);
  const results=STUDIO_PRINT_STYLES.map(({value})=>JSON.stringify(drawing(value).commands));
  expect(new Set(results).size).toBe(STUDIO_PRINT_STYLES.length);
});
it.each(STUDIO_PRINT_STYLES)('$label is deterministic, tone-sensitive, bounded and silent at zero density',({value:style})=>{
  expect(drawing(style,{density:0}).commands).toEqual([]);
  expect(drawing(style,{},0).commands).toEqual([]);
  expect(drawing(style).commands).toEqual(drawing(style).commands);
  expect(drawing(style,{},.15).area).toBeLessThan(drawing(style,{},.85).area);
  expect(drawing(style,{weight:.4}).area).toBeLessThan(drawing(style,{weight:1.4}).area);
  expect(drawing(style,{invert:true},.25).commands).toEqual(drawing(style,{},.75).commands);
  for(const angle of [-180,-90,0,90,180]) {
    const result=drawing(style,{angle,roughness:1,registration:1,weight:2,density:2});
    expect(result.commands.length).toBeLessThan(20*80);
    for(const c of result.commands)for(const v of c)if(typeof v==='number')expect(Number.isFinite(v)).toBe(true);
    expect(result.ctx.globalCompositeOperation).toBe('source-over');
    expect(result.ctx.globalAlpha).toBe(1);
  }
});
it.each(STUDIO_PRINT_STYLES)('$label carries the same geometry into a four-times larger export',({value:style})=>{
  const a=drawing(style,{},.6,10).commands,b=drawing(style,{},.6,40).commands;
  expect(a.length).toBe(b.length);
  for(let i=0;i<a.length;i++)for(let j=0;j<a[i].length;j++) {
    // An ellipse rotation is an angle, all other numeric command data is spatial.
    if(typeof a[i][j]==='number')expect(b[i][j]).toBeCloseTo((a[i][j] as number)*(a[i][0]==='ellipse'&&j===5?1:4),8);
    else expect(b[i][j]).toBe(a[i][j]);
  }
});
it('changes a shared screen angle without disconnecting neighboring engraving cuts',()=>{
  const result=drawing('engraving',{angle:0,roughness:0});
  const moves=result.commands.filter(c=>c[0]==='move'),ends=result.commands.filter(c=>c[0]==='line');
  expect(ends.some(end=>end[1]===10&&moves.some(start=>start[1]===10&&start[2]===end[2]))).toBe(true);
  expect(drawing('engraving',{angle:45}).commands).not.toEqual(result.commands);
});
it('exposes meaningful riso registration and ink separation without changing primary geometry',()=>{
  const fixed=drawing('risograph',{registration:0}),shifted=drawing('risograph',{registration:1});
  const a=fixed.commands.filter(c=>c[0]==='arc'),b=shifted.commands.filter(c=>c[0]==='arc');
  for(let i=0;i<a.length;i+=2){expect(b[i]).toEqual(a[i]);expect(b[i+1]).not.toEqual(a[i+1]);}
  expect(drawing('risograph',{secondaryInk:'#2244aa'}).commands.some(c=>c.includes('#2244aa'))).toBe(true);
  expect(drawing('risograph',{},.6,10,'source').commands).not.toEqual(drawing('risograph',{},.6,10,'accent').commands);
});
it('varies local pigment colors only in source mode and keeps spatial grain stable',()=>{
  const color=drawing('pointillism',{},.6,10,'source');
  expect(new Set(color.commands.filter(c=>c[0]==='fill').map(c=>c[1])).size).toBeGreaterThan(4);
  expect(drawing('stipple',{seed:8}).commands).not.toEqual(drawing('stipple',{seed:9}).commands);
  expect(drawing('pointillism',{roughness:0}).commands).not.toEqual(drawing('pointillism',{roughness:1}).commands);
});
