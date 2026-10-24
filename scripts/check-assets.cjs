const path = require('node:path');
const { loadAssetBundle } = require('../app/asset-files.cjs');
loadAssetBundle(path.resolve(__dirname, '../resources/miaomiao'), { models: true }).then(bundle => {
  console.log(`本地素材通过检查：${bundle.forms.length} 个形态，${bundle.forms.reduce((n, f) => n + f.clips.length, 0)} 段动作。`);
}).catch(error => {
  console.error('精灵素材未就绪。请参照 docs/assets.md 导入本机素材，再运行 npm start。\n' + error.message);
  process.exitCode = 1;
});
