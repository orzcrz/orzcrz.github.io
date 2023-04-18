/// 用于修复图片路径的问题
/// 参考 https://blog.iz4.cc/tutorial/2022/08/%E8%A7%A3%E5%86%B3hexo-asset-image%E5%9B%BE%E7%89%87%E7%9B%B8%E5%AF%B9%E8%B7%AF%E5%BE%84%E6%9B%BF%E6%8D%A2%E9%97%AE%E9%A2%98/

const fs = require('fs');

console.log('============= 补丁 ===============');

fs.copyFile('_patches/hexo-asset-image/index.js', 'node_modules/hexo-asset-image/index.js', (err) => {
    if (err) throw err;
    console.log('_patches/hexo-asset-image/index.js 替换 node_modules/hexo-asset-image/index.js');
  });