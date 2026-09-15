import { describe, expect, it } from 'vitest';
import { TemplateJSON } from '../../schema/template.js';
import { validateTemplate } from '../../template/validate.js';
import { inchesToEmu } from '../../units.js';
import { osfTemplateToJSON } from './osf.js';
import { BUILTIN_SOURCES } from './sources.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<document type="Open Screenplay Format document" version="30">
  <settings page_width="2159" page_height="2794" margin_top="254" margin_bottom="254" margin_left="381" margin_right="228"
    normal_linesperinch="6.0" element_spacing="1.00" break_on_sentences="false" dialogue_continues="true"
    dialogue_pagebreaks="true" cont_text="(cont'd)" more_text="(MORE)" scenes_continue="false" number_continued="true"
    page_header="#." page_footer="" header_alignment="3" header_first_page="false" scenenumber_mode="1AB"
    scenenumber_skip_io="false" scenenumber_start="1" scenenumber_position="3" auto_omit_scenes="false" omitted_text="OMITTED"/>
  <styles>
    <style name="Normal Text" builtin="1" builtin_index="0" font="Courier Screenplay" size="12"/>
    <style name="Scene Heading" builtin="1" builtin_index="1" basestylename="Normal Text" style_enter="Action" style_tab_after="Action" font="Courier Screenplay" size="12" spacebefore="2.0" keepwithnext="1" allcaps="1"/>
    <style name="Action" builtin="1" builtin_index="2" basestylename="Normal Text" style_tab_before="Character" style_tab_after="Character" spacebefore="1.0"/>
    <style name="Character" builtin="1" builtin_index="3" basestylename="Normal Text" style_enter="Dialogue" style_tab_before="Action" style_tab_after="Parenthetical" spacebefore="1.0" keepwithnext="1" leftindent="508" rightindent="63" allcaps="1"/>
    <style name="Parenthetical" builtin="1" builtin_index="4" basestylename="Normal Text" style_enter="Dialogue" leftindent="381" rightindent="508" keepwithnext="1"/>
    <style name="Dialogue" builtin="1" builtin_index="5" basestylename="Normal Text" style_enter="Action" leftindent="254" rightindent="381"/>
    <style name="Transition" builtin="1" builtin_index="6" basestylename="Normal Text" style_enter="Scene Heading" align="right" leftindent="1016" rightindent="127" allcaps="1"/>
    <style name="Shot" builtin="1" builtin_index="7" basestylename="Normal Text" style_enter="Action" allcaps="1"/>
  </styles>
  <lists>
    <scene_intros><scene_intro name="INT."/><scene_intro name="EXT."/></scene_intros>
    <scene_times><scene_time name="DAY"/></scene_times>
    <extensions><extension name="(V.O.)"/></extensions>
    <transitions><transition name="FADE OUT"/><transition name="CUT TO:"/></transitions>
  </lists>
</document>`;

const source = BUILTIN_SOURCES.find((s) => s.key === 'screenplay-final-draft-fi')!;

describe('osfTemplateToJSON', () => {
  const t = osfTemplateToJSON(XML, source);
  it('produces a schema-valid, internally consistent template', () => {
    expect(TemplateJSON.safeParse(t).error?.issues ?? []).toEqual([]);
    expect(validateTemplate(t)).toEqual([]);
  });
  it('converts geometry to EMU with snapping', () => {
    expect(t.page.width).toBe(inchesToEmu(8.5));
    expect(t.page.margins.right).toBe(inchesToEmu(0.9));
    const character = t.styles.find((s) => s.id === 'st_character')!;
    expect(character).toMatchObject({ role: 'character', indentLeft: inchesToEmu(2), indentRight: inchesToEmu(0.25), allCaps: true, keepWithNext: true, spaceBefore: 1 });
    expect(character.flow).toEqual({ onEnter: 'st_dialogue', onTabEmpty: 'st_action', onTabText: 'st_parenthetical' });
  });
  it('maps settings, header and deliberate differences', () => {
    expect(t.header).toMatchObject({ enabled: true, right: '{page}.', showOnFirstPage: false });
    expect(t.continueds.cont).toBe("(CONT'D)");
    expect(t.pagination.automaticContinueds.enabled).toBe(true);
    expect(t.pagination.breakOnSentences).toBe(false);
    expect(t.tagCategories).toHaveLength(29);
    expect(t.macros).toHaveLength(20);
    expect(t.smartType.transitions).toEqual(['FADE OUT.', 'CUT TO:']);
    expect(t.styles.find((s) => s.id === 'st_scene_heading')!.numbering).toMatchObject({ enabled: false, position: 'both' });
    expect(t.body).toEqual([{ styleKey: 'st_scene_heading', text: '' }]);
    expect(t.id).toMatch(/^tpl_/);
  });
});
