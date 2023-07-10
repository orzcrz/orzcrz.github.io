# 备忘

## 分支说明
- public分支
负责展示静态网页

- master分支
备份本地hexo文件，工作分支

## 常用命令
- init 新建一个博客
`hexo init [folder]`

- new 新建一篇文章
`hexo new [layout] <title>`

```shell
-p, --path	自定义新文章的路径
-r, --replace	如果存在同名文章，将其替换
-s, --slug	文章的 Slug，作为新文章的文件名和发布后的 URL
```

`hexo new page --path about/me "About me"`
以上命令会创建一个 source/about/me.md 文件，同时 title 为 “About me”

- generate 生成静态文件
`hexo g`

- server 启动服务器
`hexo server`

- deploy 部署网站
`hexo d`

- clean 清除缓存文件
`hexo clean`

- 更新master分支

```shell
git add .
git commit -m '新增博客文章'
git push origin master
```

- 更新public分支
`hexo d`

## 目录说明
工作目录如下

```shell
.
├── _config.yml
├── package.json
├── scaffolds
├── source
|   ├── _drafts
|   └── _posts
└── themes
```

- _config.yml：网站的配置信息
- package.json：应用程序的信息
- scaffolds：模版文件夹，当新建文章时，Hexo 会根据 scaffold 来建立文件
- source：存放用户资源的文件夹
- themes：主题文件夹，根据主题来生成静态页面

## 其他
### 自定义文章URL
编辑_config.yml文件：

```
permalink: :id.html
```

在写文章.md时，在文章首部加上id属性，id对应的值为该文章的URL

```
---
title: 【移动开发】Google搜索语法的使用
id: google_hack
declare: true
tags:
 - 底层技术
 - 移动开发
abbrlink: 10000
date: 1970-01-01 09:00:00
---
```

如上，则该文章URL为/google_hack.html

### 开启分类以及标签等
以开启标签(Tags)功能为例：
```shell
hexo new page tags
```

生成以下文件：source\tags\index.md
修改index.md，添加 type 属性

```
---
title: Tags
date: 2020-01-21 08:00:00
type: "tags"
---
```
写文章时在文章首部使用对应标签

```
tags:
 - 移动开发
```

分类，关于等使用类似方法

### 启用文章搜索功能
```shell
npm install hexo-generator-searchdb --save
```

编辑_config.yml，新增以下内容

```
search:
  path: search.xml
  field: post
  format: html
  limit: 10000
```

编辑主题中的_config.yml文件，开启本地搜索功能

```
local_search:
  enable: true
```

### 启用sitemap
```
npm install hexo-generator-sitemap --save
```

### 开启RSS订阅
```
npm install hexo-generator-feed --save
```

全局_config.yml中添加以下信息：

```
feed:
  type: atom
  path: atom.xml
  limit: 20
```

`hexo g` 生成`atom.xml`文件

### 搜索引擎收录
以`next`主题为例，主题`_config.yml`中自带了`site_verification`
找到对应搜索引擎，验证时选择HTML标记验证，然后将对应的content的值填入`site_verification`中即可

### 本地Hexo文件备份到Github分支

1. 建立hexo分支
将自己的Github项目克隆到本地，`git clone`

2. 删掉除了`.git`以外的所有文件

3. 将hexo blog相关文件全部复制到该文件夹

4. 检查 `.gitignore` ， 包含以下需要忽略的内容
```
.DS_Store
Thumbs.db
db.json
*.log
node_modules/
public/
.deploy*/
```

5. 创建public分支并切换到该分支
```shell
git checkout -b public
```

6. 上传到Github
```shell
git add --all
git commit -m "Add Public Branch"
git push -u origin public
```

7. 后续更新以及写文章

PS：如果主题是从Github克隆下来的，则会因为主题自身存在的.git文件夹导致无法成功上传主题文件。
解决办法：
清理缓存，删除主题中的.git文件
```shell
git rm -r --cached "文件夹的名称"
```
三步重新上传

## 补充
- 关于 `_patches` 文件夹  
主要是用于本地调试时，图片能够正确被显示。需要修改部分资源加载的源码，所以做成 patch 用 npm 跑一下即可