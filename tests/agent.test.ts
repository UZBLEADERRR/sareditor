import { AgentExecutor } from '../src/ai/agentExecutor';
import { chatWithTools, type ChatMessage } from '../src/ai/providers/toolChat';
import { AGENT_TOOLS } from '../src/ai/agentTools';
import {
  keepRanges,
  playedMs,
  removeRange,
  resize,
  setSpeedInRange,
  splitAt,
  totalSourceMs,
} from '../src/editing/segments';
import { exportConfigFor } from '../src/ffmpeg/presets';
import { SUBTITLE_STYLES } from '../src/presets/subtitleStyles';
import type { ImageOverlay, Project, Segment, VoiceClip } from '../src/types/project';
import type { Runner } from './helpers';

/** A project with no files behind it — enough for every pure code path here. */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'test',
    createdAt: 0,
    updatedAt: 0,
    source: {
      id: 'src', uri: '/tmp/a.mp4', name: 'a.mp4', durationMs: 20000,
      width: 1080, height: 1920, fps: 30, hasAudio: true, rotation: 0, sizeBytes: 1,
    },
    segments: [{ id: 's1', startMs: 0, endMs: 20000, speed: 1 }],
    subtitle: { ...SUBTITLE_STYLES.hormozi.config, enabled: true, language: 'uz', emphasisWords: [] },
    music: {
      enabled: false, startMs: 0, volumeDb: -16, duckEnabled: true, duckAmountDb: 12,
      fadeInMs: 600, fadeOutMs: 1200, loop: true, beatSync: false,
    },
    effects: {
      grade: 'none', gradeStrength: 0, vignette: 0, grain: 0, bloom: 0, sharpen: 0,
      chromatic: 0, letterbox: 0, zoom: 'none', zoomAmount: 0.12, shake: 0,
      stabilize: false, fadeInMs: 0, fadeOutMs: 0, transition: 'none', transitionMs: 300,
      fillMode: 'crop',
    },
    audio: {
      originalVolumeDb: 0, muteOriginal: false, voiceEnhance: false,
      normalizeLoudness: false, targetLufs: -14,
    },
    export: exportConfigFor('instagram_reels', 'x264'),
    overlays: [],
    library: [],
    voiceovers: [],
    renders: [],
    ...overrides,
  };
}

const overlay = (id: string, startMs: number, endMs: number): ImageOverlay => ({
  id, uri: `/tmp/${id}.png`, kind: 'image', startMs, endMs,
  phrase: '', prompt: 'x', style: 'cutaway', animation: 'fade', opacity: 1,
});

const voice = (id: string, startMs: number): VoiceClip => ({
  id, uri: `/tmp/${id}.wav`, text: 'salom', startMs, durationMs: 1200,
  volumeDb: 0, voiceLabel: 'test', duckOriginal: true,
});

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: `c_${name}`, name, args });

export async function runAgentTests(runner: Runner): Promise<void> {
  runner.section('Segment surgery');

  const whole: Segment[] = [{ id: 'a', startMs: 0, endMs: 10000, speed: 1 }];

  const split = splitAt(whole, 4000);
  runner.check('split produces two pieces', split.length === 2, `${split.length}`);
  runner.check(
    'split keeps the total length',
    totalSourceMs(split) === 10000,
    `${totalSourceMs(split)}`
  );
  runner.check('a split on the boundary changes nothing', splitAt(whole, 20).length === 1);

  const cut = removeRange(whole, 3000, 5000);
  runner.check('removing the middle leaves two pieces', cut.length === 2, `${cut.length}`);
  runner.check('removed time is gone', totalSourceMs(cut) === 8000, `${totalSourceMs(cut)}`);
  runner.check(
    'removing the head keeps one piece',
    removeRange(whole, 0, 2000).length === 1 && removeRange(whole, 0, 2000)[0].startMs === 2000
  );

  const kept = keepRanges(
    [
      { startMs: 8000, endMs: 9000 },
      { startMs: 1000, endMs: 2000 },
      { startMs: 1500, endMs: 2500 },
    ],
    10000
  );
  runner.check('keep ranges are sorted', kept[0].startMs === 1000, `${kept[0].startMs}`);
  runner.check('overlapping keeps are merged', kept.length === 2, `${kept.length}`);
  runner.check('merged range spans both', kept[0].endMs === 2500, `${kept[0].endMs}`);
  runner.check(
    'keeps are clamped to the source',
    keepRanges([{ startMs: 0, endMs: 99000 }], 10000)[0].endMs === 10000
  );

  const fast = setSpeedInRange(whole, 3000, 6000, 2);
  runner.check('speed splits at both ends', fast.length === 3, `${fast.length}`);
  runner.check(
    'only the middle piece is sped up',
    fast[1].speed === 2 && fast[0].speed === 1 && fast[2].speed === 1
  );
  runner.check(
    'speeding a stretch shortens playback',
    Math.round(playedMs(fast)) === 8500,
    `${Math.round(playedMs(fast))}`
  );
  runner.check(
    'speed is clamped to 4x',
    setSpeedInRange(whole, 0, 10000, 99)[0].speed === 4
  );

  const pair: Segment[] = [
    { id: 'a', startMs: 0, endMs: 4000, speed: 1 },
    { id: 'b', startMs: 4000, endMs: 8000, speed: 1 },
  ];
  runner.check(
    'a trim cannot cross its neighbour',
    resize(pair, 'b', { startMs: 1000 })[1].startMs === 4000
  );
  runner.check(
    'a trim cannot invert a piece',
    resize(pair, 'a', { endMs: 10 })[0].endMs === 120,
    `${resize(pair, 'a', { endMs: 10 })[0].endMs}`
  );

  runner.section('Agent executor');

  const services = { llm: { provider: 'gemini' as const, apiKey: 'k', model: 'm' } };

  // An illustration sitting after a removed stretch has to slide earlier by
  // exactly the amount that was cut, or it lands on the wrong sentence.
  const withOverlay = project({ overlays: [overlay('o1', 12000, 14000)] });
  const executor = new AgentExecutor(withOverlay, services);
  await executor.run(call('remove_range', { startMs: 2000, endMs: 5000 }));
  const patch = executor.patch();
  runner.check(
    'the cut removed three seconds',
    Math.round(totalSourceMs(patch.segments ?? [])) === 17000,
    `${Math.round(totalSourceMs(patch.segments ?? []))}`
  );
  runner.check(
    'an overlay after the cut moves earlier by the cut length',
    patch.overlays?.[0]?.startMs === 9000,
    `${patch.overlays?.[0]?.startMs}`
  );

  const insideCut = new AgentExecutor(project({ overlays: [overlay('o2', 3000, 4000)] }), services);
  await insideCut.run(call('remove_range', { startMs: 2000, endMs: 5000 }));
  runner.check(
    'an overlay inside the removed stretch is dropped, not moved',
    insideCut.patch().overlays?.length === 0
  );

  const voiceMove = new AgentExecutor(project({ voiceovers: [voice('v1', 15000)] }), services);
  await voiceMove.run(call('remove_range', { startMs: 0, endMs: 5000 }));
  runner.check(
    'a voice line follows the cut too',
    voiceMove.patch().voiceovers?.[0]?.startMs === 10000,
    `${voiceMove.patch().voiceovers?.[0]?.startMs}`
  );

  const recut = new AgentExecutor(project(), services);
  const recutResult = await recut.run(
    call('keep_ranges', { ranges: [{ startMs: 1000, endMs: 3000 }, { startMs: 6000, endMs: 9000 }] })
  );
  runner.check('a re-cut reports a change', Boolean(recutResult.change));
  runner.check('a re-cut keeps both ranges', recut.patch().segments?.length === 2);

  const refuseAll = new AgentExecutor(project(), services);
  await refuseAll.run(call('remove_range', { startMs: 0, endMs: 99999 }));
  runner.check(
    'removing everything is refused',
    (refuseAll.patch().segments ?? []).length === 1
  );

  const captions = new AgentExecutor(project(), services);
  await captions.run(call('set_captions', { fontSizePct: 99, positionPct: 40, uppercase: true }));
  runner.check(
    'caption size is clamped to something readable',
    captions.patch().subtitle?.fontSizePct === 12,
    `${captions.patch().subtitle?.fontSizePct}`
  );

  const noImages = new AgentExecutor(project(), services);
  const refused = await noImages.run(call('add_illustration', { startMs: 0, endMs: 2000, prompt: 'x' }));
  runner.check(
    'an unconfigured image model refuses instead of throwing',
    /No image model/.test(refused.result) && !refused.change
  );

  const drawn = new AgentExecutor(project(), {
    ...services,
    drawImage: async () => '/tmp/drawn.png',
  });
  await drawn.run(call('add_illustration', { startMs: 4000, endMs: 6000, prompt: 'a box' }));
  runner.check('a drawn illustration lands at its moment', drawn.patch().overlays?.[0]?.startMs === 4000);

  const spoken = new AgentExecutor(project(), {
    ...services,
    speak: async () => ({ uri: '/tmp/v.wav', durationMs: 900 }),
    voiceLabel: 'Telefon ovozi',
  });
  await spoken.run(call('add_voiceover', { text: 'Assalomu alaykum', startMs: 0 }));
  runner.check('a voice line is recorded with its label', spoken.patch().voiceovers?.[0]?.voiceLabel === 'Telefon ovozi');

  const library = project({
    library: [
      { id: 'a1', kind: 'image', uri: '/tmp/i.png', name: 'quti.png', durationMs: 0, width: 10, height: 10, note: 'quti' },
    ],
  });
  const placed = new AgentExecutor(library, services);
  const placedResult = await placed.run(call('place_library_media', { assetId: 'a1', startMs: 2000, endMs: 4000 }));
  runner.check('a library photo is placed', placed.patch().overlays?.[0]?.assetId === 'a1');
  runner.check('placing reports the asset name', /quti\.png/.test(placedResult.result));

  const missing = new AgentExecutor(library, services);
  const missingResult = await missing.run(call('place_library_media', { assetId: 'nope', startMs: 0, endMs: 1000 }));
  runner.check(
    'an unknown asset id is answered with the real ids',
    /a1/.test(missingResult.result) && missing.patch().overlays?.length === 0
  );

  const readOnly = new AgentExecutor(project(), services);
  await readOnly.run(call('read_project'));
  runner.check('a read-only run writes nothing', readOnly.touched === false);

  const finished = new AgentExecutor(project(), services);
  const finish = await finished.run(call('finish', { summary: 'Tayyor.' }));
  runner.check('finish ends the run', finish.done === true && finished.finished);

  runner.section('Tool-calling dialects');

  const messages: ChatMessage[] = [{ role: 'user', text: 'jimliklarni kes' }];
  let sent: { url: string; body: any; headers: any } | null = null;

  const stub = (payload: unknown) => {
    globalThis.fetch = (async (url: any, init: any) => {
      sent = { url: String(url), body: JSON.parse(String(init.body)), headers: init.headers };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      } as Response;
    }) as typeof fetch;
  };

  const realFetch = globalThis.fetch;
  try {
    stub({
      choices: [
        {
          message: {
            content: 'ok',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'remove_range', arguments: '{"startMs":1,"endMs":2}' } },
            ],
          },
        },
      ],
    });
    const openai = await chatWithTools(
      { provider: 'openai', apiKey: 'k', model: 'gpt' },
      { system: 's', messages, tools: AGENT_TOOLS }
    );
    runner.check('OpenAI tools are declared as functions', sent!.body.tools[0].type === 'function');
    runner.check('OpenAI arguments are parsed from their JSON string', openai.calls[0].args.startMs === 1);
    runner.check('OpenAI text comes back alongside the calls', openai.text === 'ok');

    stub({
      content: [
        { type: 'text', text: 'mayli' },
        { type: 'tool_use', id: 'toolu_1', name: 'set_look', input: { grade: 'vintage' } },
      ],
    });
    const anthropic = await chatWithTools(
      { provider: 'anthropic', apiKey: 'k', model: 'claude' },
      { system: 's', messages, tools: AGENT_TOOLS }
    );
    runner.check('Anthropic tools carry an input_schema', Boolean(sent!.body.tools[0].input_schema));
    runner.check('Anthropic system prompt stays out of the messages', sent!.body.system === 's');
    runner.check('Anthropic tool_use blocks become calls', anthropic.calls[0].name === 'set_look');

    stub({
      candidates: [
        { content: { parts: [{ functionCall: { name: 'set_speed', args: { startMs: 0, endMs: 10, speed: 2 } } }] } },
      ],
    });
    const gemini = await chatWithTools(
      { provider: 'gemini', apiKey: 'k', model: 'gemini' },
      { system: 's', messages, tools: AGENT_TOOLS }
    );
    const declarations = sent!.body.tools[0].functionDeclarations;
    const speedTool = declarations.find((tool: any) => tool.name === 'set_speed');
    runner.check('Gemini schema types are upper case', speedTool.parameters.type === 'OBJECT');
    runner.check(
      'Gemini nested property types are upper case too',
      speedTool.parameters.properties.speed.type === 'NUMBER'
    );
    runner.check(
      'Gemini no-argument tools are declared without a schema',
      declarations.find((tool: any) => tool.name === 'read_project').parameters === undefined
    );
    runner.check(
      'Gemini is not asked for JSON output while tools are on',
      sent!.body.generationConfig.responseMimeType === undefined
    );
    runner.check('Gemini functionCall parts become calls', gemini.calls[0].args.speed === 2);

    // A tool result has to survive the round trip in every dialect, otherwise
    // the second turn of the loop sends a conversation the provider rejects.
    const withResult: ChatMessage[] = [
      ...messages,
      { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'read_project', args: {} }] },
      { role: 'tool', outcomes: [{ id: 'c1', name: 'read_project', content: '{}' }] },
    ];
    stub({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
    await chatWithTools({ provider: 'gemini', apiKey: 'k', model: 'g' }, { system: 's', messages: withResult, tools: AGENT_TOOLS });
    runner.check(
      'Gemini tool results are sent as functionResponse parts',
      sent!.body.contents[2].parts[0].functionResponse.name === 'read_project'
    );

    stub({ choices: [{ message: { content: 'done' } }] });
    await chatWithTools({ provider: 'openai', apiKey: 'k', model: 'g' }, { system: 's', messages: withResult, tools: AGENT_TOOLS });
    runner.check(
      'OpenAI tool results become tool-role messages',
      sent!.body.messages.at(-1).role === 'tool' && sent!.body.messages.at(-1).tool_call_id === 'c1'
    );

    stub({ content: [{ type: 'text', text: 'done' }] });
    await chatWithTools({ provider: 'anthropic', apiKey: 'k', model: 'g' }, { system: 's', messages: withResult, tools: AGENT_TOOLS });
    runner.check(
      'Anthropic tool results are user-role tool_result blocks',
      sent!.body.messages.at(-1).content[0].type === 'tool_result'
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}
