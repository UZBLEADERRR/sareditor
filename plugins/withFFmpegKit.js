const { withProjectBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARKER = '// sareditor:ffmpeg-kit-repositories';

/**
 * Registers the repositories Gradle needs in order to resolve
 * `com.arthenica:ffmpeg-kit-*`.
 *
 * The artifacts were pulled from Maven Central when ffmpeg-kit was retired, so
 * they are vendored into ./vendor/m2 by `npm run ffmpeg:fetch`. An extra remote
 * repository can be layered on through FFMPEG_KIT_MAVEN_URL for teams that host
 * the binary in their own Nexus/Artifactory.
 */
function withFFmpegRepositories(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFFmpegKit only supports the Groovy android/build.gradle');
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }

    const extraRemote = process.env.FFMPEG_KIT_MAVEN_URL
      ? `\n        maven { url = uri("${process.env.FFMPEG_KIT_MAVEN_URL}") }`
      : '';

    const block = [
      `        ${MARKER}`,
      '        maven { url = uri("${rootProject.projectDir}/../vendor/m2") }',
      extraRemote,
    ]
      .filter(Boolean)
      .join('\n');

    // Splice into the existing `allprojects { repositories {` block when the
    // template has one, otherwise append a standalone block.
    const anchor = /allprojects\s*\{[\s\S]*?repositories\s*\{/;
    if (anchor.test(cfg.modResults.contents)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        anchor,
        (match) => `${match}\n${block}`
      );
    } else {
      cfg.modResults.contents += `\n\nallprojects {\n    repositories {\n${block}\n    }\n}\n`;
    }
    return cfg;
  });
}

function withFFmpegGradleProperties(config, props) {
  return withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    };
    set('sarEditor.ffmpegKit.variant', props.variant);
    set('sarEditor.ffmpegKit.version', props.version);
    return cfg;
  });
}

const withFFmpegKit = (config, props = {}) => {
  const resolved = { variant: 'full-gpl', version: '6.0-2', ...props };
  config = withFFmpegRepositories(config);
  config = withFFmpegGradleProperties(config, resolved);
  return config;
};

module.exports = withFFmpegKit;
