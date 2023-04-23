---
title: 'hey gay, @property了解下'
date: 2020-09-01 17:47:51
tags: Objective-C 
categories: 八股文
---

先说点废话，看过一个段子说是面试问 weak 的经历，大概是这样：

- 2014年
**A：** weak是什么
**B：** 弱引用，释放时自动置nil
**A：** 明天来上班

- 2016年
**A：** weak是什么
**B：** 弱引用，释放时自动置nil，内部通过哈希表维护，
**A：** 回去等通知

- 2018年
**A：** weak是什么
**B：** 弱引用，释放时自动置nil，内部通过哈希表维护，runtime里是这样(>=2000字)实现的
**A：** 回去等通知

- 2020年
**A：** weak是...
**B：** 别说了，我现场给你写个出来
**A：** 小伙子挺不错的，回去等通知

<!-- more -->

站在面试者的角度来讲，这种问题别问，问就是装逼，开发能用到？对于正经的面试官来讲，为了筛选喜欢探索、喜欢折腾、喜欢刨根问底的人才。立场和角度不同，所以没有所谓的对错，只是确实有一篇篇“底层探索、原理解析”的文章流传在网络上，供大家在面试前疯狂翻阅背诵，这也正是恶性循环的开始。

**正能量：** 我也曾有过这种经历，然而转念一想，其实那些文章的作者花心思花时间总结出来给大家阅读，确实是带来正能量的。我们除了白嫖，默默地看完然后继续下一篇之外，是否真的有从里面总结提炼出可以化为自身能力的东西呢，还是说仅仅是增加了面试的筹码而已。举个场景，若干年后地iOS开发，语言已全面换成swift了，而你所铭记在心的weak原理早已蒙尘许久，然后呢，开始新一轮的swift底层原理的文章通览默记，去应对下一场面试，完全不正能量啊。如果说天资过人，鸿运当头，早早的实现财务自由，创业成功，晋升高管，那肯定看不到我现在写的圣母文。我想强调的是，对大多数平凡而努力的开发者而言，心中无码才是至高境界啊，牛逼的是逻辑思维能力，是与众不同的想法，是高效做事的方法，而不是底层原理啊。

经过开篇正能量的洗礼后，我们来谈谈本文的主题，了解下OC里的`property`，限于篇幅和水平，细节点就不贴代码凑字数了，有兴趣的可以自己去探索。

### 属性的本质

直观点就按着`property = setter + getter + ivar`理解，而按照果爹的官宣来讲，OC里的属性是通过`@property`定义的公开或私有的方法，具体点来讲还牵扯到编译器的新老更迭导致的coding方式不同。本文就基于`Clang-LLVM`的新编译器做理解分析就好，不扩展，不粘贴。而分析方法其实很早之前我们的语文老师已经教过我们了，说是英语老师教的也行，我们可以按着主谓宾来拆解。

代码的本质是语言，机器和人都有各自的方言，那么编译器就负责双向的翻译。套用到这里，类似`@property xxx`就是一句类似你弄啥咧的方言，是给我们开发者看的，这句话机器就听不懂，就得由美女翻译官在线翻译，把意思转诉给机器。整个流程就是我们声明属性，编译器生成`setter`、`getter`、实例，再转诉给机器，帮助我们完成想要做的事情，传递想要表达的意思。我们先看看属性的整体结构都是个啥：
![](/property/property.jpg)

我们关注的一般都在括号里“复词”的部分，所以我尽量罗列些能找到的关键字：

- `atomic` & `nonatomic`
- `readwrite` & `readonly`
- `weak` & `assign` & `unsafe_unretained`
- `copy` & `strong` & `retain`
- `nullable` & `nonnull`
- `setter` & `getter`
- `null_resettable` & `null_unspecified`
- `class`

按照结构图的归纳，其实分类后就一丢丢，以后的重心会是swift，OC的话可能很少再新增特性了。平时我们用的也频繁，不如做个全面了解纪念下，留着以后给孩子讲故事用。我们看看这些方言想要表达意思，究竟是个啥。

### 各个关键字的含义

简单先说下`@synthesize`和`@dynamic`，就是告诉编译器是否要自动合成属性，我们现在一般不特指的话都是会自动合成的，所以其实你每声明一个属性，都会有配套的`setter`、`getter`、`_ivar`生成，这也是有些包大小**极端**优化的文章里提到的需要处理的地方。这个没啥意思，我们再看看其他属性的组成部分。

#### 原子性

由关键字`atomic`和`nonatomic`支持，默认是`atomic`，会告诉编译器在生成`setter`和`getter`方法时是否要加锁，以**牺牲部分性能**换来可靠的读写操作。这也就意味着，在调用`xxx.yyy`的时候会更慢，但不用担心`_yyy`在多线程读写过程中的竞争问题。

```
  // codes from objc4-781

  // the setter
  {
    ...
    if (!atomic) {
        oldValue = *slot;
        *slot = newValue;
    } else {
        spinlock_t& slotlock = PropertyLocks[slot];
        slotlock.lock();
        oldValue = *slot;
        *slot = newValue;
        slotlock.unlock();
    }
    ...
  }

  // the getter
  {
    ...
    if (!atomic) return *slot;

    spinlock_t& slotlock = PropertyLocks[slot];
    slotlock.lock();
    id value = objc_retain(*slot);
    slotlock.unlock();
    return objc_autoreleaseReturnValue(value);
  }
```

#### 读写

由关键字`readwrite`和`readonly`支持，默认的`readwrite`会让编译器同时生成`setter`和`getter`方法，而`readonly`的话顾名思义就只提供`getter`方法。

#### 辅助词

- `nullable` & `nonnull`

  用于标识该属性值是否可空，需要限定当前属性变量是指针式的，如`NSString *`、`int *`，而基础数据类型则不行。类比下`swift`的`?`和`!`，如果对一个`nonnull`修饰的属性赋值`nil`，`Xcode`会贴心地给你个黄牌警告。事实上，如果需要每个属性或每个方法的参数和返回值都去指定`nonnull`和`nullable`，是一件非常繁琐的事。苹果为了减轻我们的工作量，专门提供了两个宏：`NS_ASSUME_NONNULL_BEGIN`和`NS_ASSUME_NONNULL_END`，把它们插在在类文件头尾，那么所有的方法和属性都会自动加上`nonnull`关键字，我们可以单独指定那些需要`nullable`的部分。
  
```
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ViewController : UIViewController

@property (nonatomic, strong/*, nonnull*/) UIView *nonnullView;
@property (nonatomic, copy, nullable) NSString *nullableString;

@end

NS_ASSUME_NONNULL_END
```

- `setter` & `getter`
  可以指定`set`方法或`get`方法的别名，没啥意思，但也聊两句骚话。命名一直是编程的头等大事，好的命名可以提高码农的读写效率至少30%，各方大哥大佬们想尽办法去寻找优秀的命名手段，大小驼峰啊，下划线啊，匈牙利啊，都是尝试去做到好的命名。举，这里我们声明属性`blue`，在赋值时可以叫`setBlue:`，很舒服，那么在用点语法调用`BOOL a = xxx.blue`时就不太爽，所以指定个别名`isBlue`变成`BOOL a = xxx.isBlue`，这样就爽很多。

- `null_resettable` & `null_unspecified`
  这两个关键字也需要限定当前属性变量是指针式的，如`NSString *`、`int *`，而基础数据类型则不行。
  - 对于`null_resettable`，我们最熟悉的`UIViewController`，它的属性`view`即是用的此关键字，意味着我们可以对该属性赋值`nil`，但我们在通过`self.view`获取其值时**一定不为空**。
  ```
  @property(null_resettable, nonatomic,strong) UIView *view; // The getter first invokes [self loadView] if the view hasn't been set yet. Subclasses must call super if they override the setter or getter.

  // 大概是这么个创建形式
  - (UIView *)view {
    if (_view) return _view;
    _view = UIView.new;
    return _view;
  }
  ```
  - 对于`null_unspecified`倒是很少提及和使用，按照字面意思理解的话，应该是所修饰属性的值和类型都他娘的不确定。而少见的原因大概是果爹仅仅是为了迁移到`swift`强行加进去的，按着下面的`swift`代码理解下吧：
  ```
  class Test {
    var a: String! // 看我，我就是null_unspecified
  }
  ```

- `class`
简而言之，就是声明为类属性，是的，也是他娘的为了`swift`服务的。然后你得自己去实现`setter`和`getter`，觉得无聊是吧，我也这么觉得，所以我用的最多的地方就是实现单例类的`sharedInstance`方法而已。

```
// .h
@property (nonatomic, readonly, class) MyType *sharedInstance;

// .m
+ (instancetype)sharedInstance {
    static id instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[self alloc] init];
    });
    return instance;
}
```

#### 内存管理

这个地方可以说是面试的重灾区，而且网上的文章解析一大堆，其实粗浅的说起来也没啥意思的，大家都烂熟于心。而要引申的话，一个关键字可以说一天，也有点过分。综上，还是简单点吧（可不是懒，码农的事怎么能说是偷呢 ---- 窃·格瓦拉·码男）。

- `weak` & `assign` & `unsafe_unretained`

给它们仨放一块是因为它们都不会持有修饰的实例，且不会增加引用记数。`assign`和`unsafe_unretained`说起来其实没差别，只是从语义上来讲后者用于修饰对象，毕竟`retain`也算是老牌的`strong`呢。`weak`的话，各种长篇大论网上多的是，我这里也不废话了，它相较于其他两种关键字，它会在对象销毁时，将其自动指向nil。

举，以前用`assign`修饰`delegate`实例，然后在`dealloc`里手动加上`_delegate = nil;`以杜绝野指针问题，用了`weak`以后，无残留的特性让我们省力很多。朴实无华的原理就是记录类里面的每个`weak`的实例，然后在销毁时遍历记录表，一一对比然后`referer = nil;`就完了。当然啦，落地这个东西涉及的具体细节很多，可以去翻翻源码。

- `copy` & `strong` & `retain`

上面一条也提到过，`retain`算是老牌的`strong`，老夫很久都没用过`retain`了。二者特点都是生成新指针指向被引用对象的地址，一处改动，处处改动；不会生成新对象；会增加被引用对象的引用记数，使其生命力更强更持久。

另外，网上一些说法是在修饰block属性时，两者是有区别的。`strong`修饰block会有`copy`行为(所以我们在ARC下写block也没必要用`copy`)，而`retain`则没有，仅仅只是个`assign`的作用。可以随便写个例子，按照`Xcode-->Product-->Perform Action-->Assemble "XXX"`得到当前类文件的汇编，可以确认这一结论。

```
// strong修饰
## -- Begin function -[ViewController setBlock0:]
"-[ViewController setBlock0:]":         ## @"\01-[ViewController setBlock0:]"
...
 callq _objc_setProperty_nonatomic_copy
...
## -- End function

// retain修饰
## -- Begin function -[ViewController setBlock1:]
"-[ViewController setBlock1:]":         ## @"\01-[ViewController setBlock1:]"
...
  callq *_objc_release@GOTPCREL(%rip)
...
## -- End function
```

而对于`copy`的话，也是个面试重灾区，单独拎出来梳理下。个人瞎鸡巴猜它应该是针对OC里的可变及不可变对象派生出来的，那有哪些特点呢？`copy`是个有针对性的关键字，它修饰的对象**始终是不可变的**；可变对象和不可变对象对应的拷贝方法分别是`copy`及`mutableCopy`，其底层对应的也就是`copyWithZone:`和`mutableCopyWithZone`，有兴趣可以找找`NSCopying`和`NSMutableCopying`协议看看；而`copy`在修饰不可变对象时平平无奇，表现上与`strong`无异，新瓶装99，新指针->老对象，也就是传说中的**浅拷贝**，but在修饰可变对象时会真正的new一个新的不可变对象出来以维持其**始终是不可变的**原则。

被人说烂的地方就是用`copy`修饰`NSSString`比较安全，防止被赋值给它的`NSMutableString`对象的后续改动牵扯到，可以回顾上面的`strong`特性。但是极端点的话，随便你用什么关键字修饰，结果我根本不调用`xxx.yyy`，直接用`_yyy`去赋值，也还是会存在问题。所以我们在遇见可变对象赋值给不可变对象，一般手动带个[xxx copy]的调用是最靠谱的。

另外，真不是我偷懒，对`NSString *`、`NSMutableString`或者各种可变不可变容器类的深浅拷贝测试代码，网上也是很多很多很多，这里再粘过来也没意思，个人建议为了强化理解和认知，自己写点测试代码是最好不过的。

```
// 我们声明的copy属性，最终调用代码
void objc_setProperty_atomic_copy(id self, SEL _cmd, id newValue, ptrdiff_t offset)
{
    reallySetProperty(self, _cmd, newValue, offset, true, true, false);
}

void objc_setProperty_nonatomic_copy(id self, SEL _cmd, id newValue, ptrdiff_t offset)
{
    reallySetProperty(self, _cmd, newValue, offset, false, true, false);
}

static inline void reallySetProperty(id self, SEL _cmd, id newValue, ptrdiff_t offset, bool atomic, bool copy, bool mutableCopy)
{
  ...
  if (copy) {
      newValue = [newValue copyWithZone:nil];
  } else if (mutableCopy) {
      newValue = [newValue mutableCopyWithZone:nil];
  } else {
      if (*slot == newValue) return;
      newValue = objc_retain(newValue);
  }
  ...
}
```

### 在OC中使用实例变量或属性是一种怎样的体验

尽管果爹在文档里明确说了，尽可能用属性代替实例变量，其好处多多。但实际上对于用属性好还是用实例变量好，依旧是众口难调，而任何一刀切的做法又都过于极端。看看别人的观点，比如我有个朋友A和B，他们的观点我列在下面：

- A，泻药，认为用属性好
  - 属性写起来似乎很长，但实际上用**CodeSnippets**来写，2个字母就写出来了，而且是具有高可读性，高完整性的声明
  - 自动创建的`setter`和`getter`方法，在需要的时候重写即可，毫无成本，轻松愉快
  - 更OC，遇到在block中的实例变量，如果用`_yyy`这种，还会收到循环引用的警告，强迫症的话不得不改成`xxx->_yyy`的写法，整的像调用`struct`一样

- B，刚下飞机，认为用实例变量好
  - 属性会从代码层面带来包大小的负担，而且是不可压缩的
  - 使用`xxx.yyy`的方式，实际上是在调用方法，某些重写`getter`的懒加载属性，内部还会执行一次判空，想想就恶心
  - 通过`xxx.yyy = zzz`和`_yyy = zzz`赋值，本质上一个是调用`setXxx:`方法，一个是直接对变量赋值，但经常看见混用的，强迫症受不了
  - 补充上一条，某些`lazy code`还必须用`_yyy`这种形式，否则可能会过早的创建实例导致不符预期的行为，所以每次使用的时候还要过脑子，增加额外的脑细胞劳损

个人认为，既然大家都喜欢吹牛逼，说是要对写的每一行代码负责，那么在使用属性或者实例变量的时候，如果有统一的规范约束，那就是答案，如果没有就想想为什么这里用属性那里用变量，无论是追求官网风格、大神洁癖、装B、没理由、我流、无脑流等等，都是属于你个人行为意识的体现，没有绝对的好坏之分，只是当别人问你时，必须要自信的给出你的答案，让人拍腿直呼霸气外露，这事就算成了。

## 后记

能坚持看到这里的都是真爱，先说声谢谢，分享的东西都很粗浅，但是知道概念是一回事，很好的表达出来又是一回事，所以才有了这个花果山。同时我也还是希望给大家带来满满的正能量，所以再补充些骚话：回头看看我自己的开发历程，都只是摸爬滚打，靠着一腔兴趣撑到现在，而终于没有一个领域精通或者擅长，都是浅浅的浮于表面；一方面是自己没有做足够的回顾总结，另一方面没有意识去培养系统化思考，高效的学习方法等，所以一直处理半桶水的样子；建这个花果山的初衷，也是希望像那些大佬一样，坚持阅读和学习，总结记录，有条理有思考，能够沉淀足够多的能量，突破自我。

## 参考连接

- [Adopting Modern Objective-C](https://developer.apple.com/library/archive/releasenotes/ObjectiveC/ModernizationObjC/AdoptingModernObjective-C/AdoptingModernObjective-C.html)
- [Encapsulating Data](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/EncapsulatingData/EncapsulatingData.html)
- [Nullability Annotations in Objective-C](https://swiftunboxed.com/interop/objc-nullability-annotations/)
- [『Apple API』Nullability](http://www.saitjr.com/ios/apple-api-nullability.html)
- [[cfe-dev] RFC: Nullability qualifiers](http://lists.llvm.org/pipermail/cfe-dev/2015-June/043698.html)
