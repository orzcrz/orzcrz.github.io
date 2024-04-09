---
title: 深入理解 Block
date: 2023-04-20 16:31:15
tags: Objective-C 
categories: [ 底层原理, 八股文 ]
---

# 前言
Block 是 `Objective-C（简称OC）` 中对闭包（Closure）的实现，果爹通过一系列黑活保证其拥有闭包的特性，又能装成 `OC` 对象被使用。关于 Block 的一些认识现在被纳入八股文体系中，那么我就不得不梳理一篇文章出来，以备不时之需。

<!-- more -->

整体分成五块内容：
- 基本原理
- 类型介绍
- 特性分析
- 内存管理
- 扩展

## 基本原理
对于 Block 的声明和函数指针基本一样，它的调用本质其实也是函数指针的调用。
- 函数指针的定义
```
返回类型 (*指针变量名称) (参数)
```

- Block 的定义
```
返回类型 (^Block名称) (参数)
```

那么 Block 是如何体现闭包特性的，又是如何被调用的呢？先在 Demo 中实现代码
```objectivec
int main() {
    @autoreleasepool {
        int age = 30;
        void (^block)(int, int) = ^(int a, int b) {
            NSLog(@"%d%d退休", a, b);
            NSLog(@"age = %d", age);
        };
        block(3, 5);
    }
    return 0;
}
```
通过 `xcrun -sdk iphoneos clang -arch arm64 -rewrite-objc main.m` 将代码展开成 `main.cpp`，在生成的 cpp 文件底部可以找到代码，注释当然是我另加的
```objectivec
/// Block 的数据结构
struct __block_impl {
  void *isa;    //isa指针，oc对象都有这个指针
  int Flags;    //标识
  int Reserved; //保留字段，默认=0
  void *FuncPtr;    //block 的函数指针
};

/// 最前面是block 所在的方法名，第几个结尾的数字就递增
/// 这个 struct 主要用来承载我们声明的 block 实例
struct __main_block_impl_0 {
  /// 函数指针和 OC 对象结合的胶水类，原型是 Block_layout
  struct __block_impl impl;
  /// 当前 block 的补充信息，因捕获变量的行为有所变化，文章下面有展开
  struct __main_block_desc_0* Desc;
  /// 用到的上下文
  int age;
  /// 构造函数
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, int _age, int flags=0) : age(_age) {
    impl.isa = &_NSConcreteStackBlock; /// 这里比较有意思，指定 Block 实例在 OC 中的对象类型，文章下面有展开
    impl.Flags = flags; 
    impl.FuncPtr = fp;  
    Desc = desc;
  }
};

/// Block 对应的待执行函数
static void __main_block_func_0(struct __main_block_impl_0 *__cself, int a, int b) {
  int age = __cself->age; // bound by copy
  NSLog((NSString *)&__NSConstantStringImpl__var_folders_v2_h365bjbs0kvdryv303hjf5tw0000gn_T_main_1dbf33_mi_0, a, b);
  NSLog((NSString *)&__NSConstantStringImpl__var_folders_v2_h365bjbs0kvdryv303hjf5tw0000gn_T_main_1dbf33_mi_1, age);
}

static struct __main_block_desc_0 {
  size_t reserved;
  size_t Block_size;
} __main_block_desc_0_DATA = { 0, sizeof(struct __main_block_impl_0) };

int main() {
    /* @autoreleasepool */ { __AtAutoreleasePool __autoreleasepool; 
        int age = 30;
        /// 看着复杂，实际上就是初始化 __main_block_impl_0，然后取地址得到首个变量 impl 的地址，然后干活
        void(*block)(int ,int) = ((void (*)(int, int))&__main_block_impl_0((void *)__main_block_func_0, &__main_block_desc_0_DATA, age));
        ((void (*)(__block_impl *, int, int))((__block_impl *)block)->FuncPtr)((__block_impl *)block, 3, 5);
    }
    return 0;
}
```
代码中可以看出，在 Block 的代码展开后，其调用在 `block->FuncPtr` 这里，这也就意味着 Block 的调用不走 OC 消息转发。并且在 `__block_impl` 这个代表 Block 的结构体中，可以看到 `isa` 的存在，这也就意味着其对象特性是通过这里来实现的，可以通过一段有趣的代码一探究竟
```objectivec
// 这是个结构体，大家都看出来了吧
struct FakeObject {
    Class isa;
} FakeObject; //在这就创建好了

// 对栈上的结构体 FakeObject 变量赋值，指定 isa 为 NSObject.class
FakeObject.isa = NSObject.class;

// 取结构体首地址，也就是 isa 的地址，转成 NSObjct 类型的实例
NSObject *obj = (__bridge NSObject*)&FakeObject;
// 是的，这里就可以给这个结构体发消息了
NSLog(@"%@", obj.description);
```
可以看到这里相当于在**栈上**创建了一个 `NSObject` 实例，再看看上面 Block 展开代码中的 `isa` 处理
```objectivec
impl.isa = &_NSConcreteStackBlock
```
这里的代码意图就很清晰了，至于为什么这么绕这么设计，**前言**就说了它要有闭包特性，又能装成 OC 对象。闭包特性好说，装成 OC 对象是干啥的呢？
除了响应一切皆对象的口号，看起来更 OC，更重要的是能参与 OC 的内存管理那套，用起来也 OC，不然声明就直接对接函数指针了，两者几乎一致，搞那些有的没有，搞的自己很帅。
言归正传，下面我们详细说说这个 `isa` 指向的几种 Block 对象。

## 类型介绍
具体有哪些类型基本上都能在 `libclosure-79/data.m` 中看到，这里一一列举介绍。

### NSBlock
通过源码 `libclosure-79/data.m` 中的注释可以了解到，NSBlock 是动态插入作为 __NSXXXBlock 的父类。由于各种原因（偷懒），我也就没有去探查下去。
> We define these classes, and CF will later when it initializes inject NSBlock as the real parent for `__NSStackBlock__`, `__NSMallocBlock__`,`__NSAutoBlock__` and `__NSGlobalBlock__`.

### \_\_NSStackBlock__
顾名思义，表示分配在栈上的 Block 类型。通常 Block 中访问了外部临时变量且没有 copy 调用，那么这时候 Block就是该类型，这也是 Block 的默认类型。下方的代码即是一个 StackBlock
```objectivec
int age = 30;
NSLog(@"age = %d", ^int(){
  return age;
}());
```

可以通过简单的调试确认（直接Assembly看汇编也可以）
1. 先输出 `__NSStackBlock__` 的地址，即
```objectivec
NSLog(@"%p", NSClassFromString(@"__NSStackBlock__"));

/// 控制台输出如下
2023-04-24 11:00:14.497729+0800 BlockDemo[21136:16771217] 0x1001f8018
```

2. 在 `return age;` 处下断点，进入断点后，在控制台输入 `frame info` 可以查看当前执行栈信息，类似如下，这其中 `block_descriptor=0x000000016fdfedf8` 可以看成是上面示例代码中的`__block_impl`，那么首地址即是指定Block对象的 `isa` 的地址
```objectivec
frame #0: 0x0000000100003ecc BlockDemo`__main_block_invoke(.block_descriptor=0x000000016fdfedf8) at main.mm:70:20
```

3. 在控制台输出 `mem read 0x000000016fdfedf8`，可以得到内存信息如下，首行对应的这个地址。由于 iOS 是小端模式，需要转换字节序，转换后对比步骤1中的地址，可以看到是一致的
```objectivec
0x16fdfedf8: 18 80 1f 00 01 00 00 00 00 00 00 c0 00 00 00 00  ................
0x16fdfee08: b8 3e 00 00 01 00 00 00 10 40 00 00 01 00 00 00  .>.......@......
```

### \_\_NSMallocBlock__
表示存放于堆上的 Block 类型，这种 Block 几乎只能由内部的 copy 操作生成，我们日常开发是无法直接创建的。比如上面示例代码中的 `void(^block)(int ,int)` 赋值过程，可以理解为：
- 声明了一个匿名 Block，对应 `__NSStackBlock__`
- 赋值给左边的 `block` 实例时，由于默认 ARC 的情况下，左边的实例为`__strong` 修饰，那么编译器会插入的 `copy` 调用
- 最终 `block` 实例对应的是 `__NSMallocBlock__`

在 ARC 环境下，一般会自动将 StackBlock 拷贝成 MallocBlock 的情况有：
- 作为函数返回值
- 赋值给 __strong 的实例
- 系统SDK的方法中带有 `usingBlock` 的参数
- GCD的调用入参

### \_\_NSGlobalBlock__
在 Block 中访问了外部全局变量或静态局部变量的时候，对应的即是该类型。就按照 `static void block()` 这种静态方法理解好了，其调用编译时就确定了，然后打在 `__DATA` 数据段中。
比如下面的代码就是个 GlobalBlock，可以通过分析栈Block段落里的方法确认
```objectivec
NSLog(@"age = %d", ^int(){
  return 30;
}());
```

### ~~\_\_NSAutoBlock__~~
参与 GC 对 Block 进行内存管理的相关逻辑
### ~~\_\_NSFinalizingBlock__~~
继承于 `__NSAutoBlock__` 的类，也是算个助力 GC 内存管理的功能类吧
### ~~\_\_NSBlockVariable__~~
GC配套，注释也说明的很清楚，感兴趣就自行探究吧（doge）。

## 特性分析
开头的示例代码中，我们声明的 Block 代码会被编译器转换成一个静态函数，即 `__main_block_func_0`，内部需要的变量都通过参数传进来，这没问题，可是一旦函数内部需要修改这些外部变量的值，那么问题就来了，如何保证这些值在函数内使用期间没有被释放，如何保证修改会影响原始值等等等等，下面会就此展开介绍。
### 变量捕获
为了保证 Block 内部能够正常访问外部变量，这里就引入了一个变量捕获机制（闭包都有，不是新鲜事儿）。同时其捕获机制针对不同类型的变量体现了不同的策略，因而显得复杂起来，加入了八股文中。这里按临时变量，局部静态变量，全局变量介绍，示例代码如下
```objectivec
int c = 100; // 全局变量
static int d = 200; // 静态变量
int main() {
    @autoreleasepool {
        int a = 35; // 临时变量
        static int b = 50; // 局部静态变量
        void(^block)(void) = ^{
            NSLog(@"a = %d, b = %d, c = %d, d = %d", a, b, c, d);
        };
        block();
    }
    return 0;
}
```

代码展开后
```objectivec
struct __main_block_impl_0 {
  struct __block_impl impl;
  struct __main_block_desc_0* Desc;
  int a;
  int *b;
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, int _a, int *_b, int flags=0) : a(_a), b(_b) {
    impl.isa = &_NSConcreteStackBlock;
    impl.Flags = flags;
    impl.FuncPtr = fp;
    Desc = desc;
  }
};

static void __main_block_func_0(struct __main_block_impl_0 *__cself) {
  int a = __cself->a; // bound by copy
  int *b = __cself->b; // bound by copy
  NSLog((NSString *)&__NSConstantStringImpl__var_folders_v2_h365bjbs0kvdryv303hjf5tw0000gn_T_main_6f6854_mii_0, a, (*b), c, d);
}

static struct __main_block_desc_0 {
  size_t reserved;
  size_t Block_size;
} __main_block_desc_0_DATA = { 0, sizeof(struct __main_block_impl_0) };

int main() {
    /* @autoreleasepool */ { __AtAutoreleasePool __autoreleasepool; 
        int a = 35;
        static int b = 50;
        void(*block)(void) = ((void (*)())&__main_block_impl_0((void *)__main_block_func_0, &__main_block_desc_0_DATA, a, &b));
        ((void (*)(__block_impl *))((__block_impl *)block)->FuncPtr)((__block_impl *)block);
    }
    return 0;
}
```
#### 临时变量
从上述代码中可以看到，在 `__main_block_impl_0` 中定义了 `int a` 的成员变量来储存要访问的临时变量 `a`，考虑到访问安全，变量传值方式为值传递。

#### 局部静态变量
`__main_block_impl_0` 中定义了 `int *b` 存储要访问的局部静态变量 `b`，因为静态变量的特性，传值方式为引用传递。

#### 全局变量
很明显，在 `__main_block_impl_0` 中根本就没出现 `c` 和 `d` 的成员变量，也就是说这两个变量不需要捕获，因为其本身就支持跨函数访问。
#### 总结
局部变量都会被block捕获，临时变量是值捕获，静态变量为地址捕获，全局变量不会被捕获。

<table style='text-align: center;'>
	<tr>
    <th colspan='2' style="text-align: center">变量类型</th>
    <th style="text-align: center">处理策略</th>
    <th style="text-align: center">访问方式</th>
	</tr>
	<tr>
    <td rowspan='2'>局部变量</td>
    <td>临时变量</td>	
    <td>捕获</td>	
    <td>值</td>	
	</tr>
	<tr>
    <td>局部静态变量</td>	
    <td>捕获</td>	
    <td>引用</td>	
	</tr>
	<tr>
    <td colspan='2'>全局变量</td>
    <td>无需捕获</td>	
    <td>直接</td>	
	</tr>
</table>

### 修饰词
为满足实际开发中的各种需要，Block 还需要搭配不同的修饰词使用。

#### __block
简单来说，`__block` 作用是允许 Block 内部修改从外部捕获的变量。
示例代码
```objectivec
int main() {
    @autoreleasepool {
        __block int a = 35;
        void(^block)(void) = ^{
            a = 50;
        };
        block();
        NSLog(@"a = %d", a);
    }
    return 0;
}
```

展开后的代码
```objectivec
struct __Block_byref_a_0 {
  void *__isa; // 万一是 OC 对象呢
__Block_byref_a_0 *__forwarding;
 int __flags;
 int __size;
 int a;
};

struct __main_block_impl_0 {
  struct __block_impl impl;
  struct __main_block_desc_0* Desc;
  __Block_byref_a_0 *a; // by ref
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, __Block_byref_a_0 *_a, int flags=0) : a(_a->__forwarding) {
    impl.isa = &_NSConcreteStackBlock;
    impl.Flags = flags;
    impl.FuncPtr = fp;
    Desc = desc;
  }
};

static void __main_block_func_0(struct __main_block_impl_0 *__cself) {
  __Block_byref_a_0 *a = __cself->a; // bound by ref
  (a->__forwarding->a) = 50;
}

static void __main_block_copy_0(struct __main_block_impl_0*dst, struct __main_block_impl_0*src) {_Block_object_assign((void*)&dst->a, (void*)src->a, 8/*BLOCK_FIELD_IS_BYREF*/);}

static void __main_block_dispose_0(struct __main_block_impl_0*src) {_Block_object_dispose((void*)src->a, 8/*BLOCK_FIELD_IS_BYREF*/);}

static struct __main_block_desc_0 {
  size_t reserved;
  size_t Block_size;
  void (*copy)(struct __main_block_impl_0*, struct __main_block_impl_0*);
  void (*dispose)(struct __main_block_impl_0*);
} __main_block_desc_0_DATA = { 0, sizeof(struct __main_block_impl_0), __main_block_copy_0, __main_block_dispose_0 };

int main() {
    /* @autoreleasepool */ { __AtAutoreleasePool __autoreleasepool; 
        __attribute__((__blocks__(byref))) __Block_byref_a_0 a = {(void*)0,(__Block_byref_a_0 *)&a, 0, sizeof(__Block_byref_a_0), 35};
        void(*block)(void) = ((void (*)())&__main_block_impl_0((void *)__main_block_func_0, &__main_block_desc_0_DATA, (__Block_byref_a_0 *)&a, 570425344));
        ((void (*)(__block_impl *))((__block_impl *)block)->FuncPtr)((__block_impl *)block);
        NSLog((NSString *)&__NSConstantStringImpl__var_folders_v2_h365bjbs0kvdryv303hjf5tw0000gn_T_main_c3aed9_mii_0, (a.__forwarding->a));
    }
    return 0;
}
```
可以看到，相比只读情况的代码多了 `__Block_byref_a_0`，以及在 `__main_block_desc_0` 中多了 copy 和 dispose 的函数，并可以对应找到其生成的代码。
不难看出，copy 和 dispose 操作的是 `__main_block_impl_0` 实例，内部调用了 Block 源码中的 `_Block_object_assign` 及 `_Block_object_dispose`，这两个函数的实现就躺在 `libclosure-79/runtime.c` 里，注释写的很详细，主打一个内存管理。

上下文中由原先操作变量 `a` 的地方，都给改成了操作 `__Block_byref_a_0` 实例的成员变量，这都是编译器干的好事，主要包括以下几点
1. 将 `__block` 变量包装成一个结构体 `__Block_byref_a_0` 
2. 结构体内部 `*__forwarding` 是指向自身的指针
3. 结构体内部还存储着外部 `a` 的值

此时如果 `block` 是在栈上，那么这个 `__forwarding` 指针就是指向它自己；当这个 `block` 从栈上复制到堆上后，栈上的 `__forwarding` 指针指向的是复制到堆上的 `__block` 结构体，堆上的 `__block` 结构体中的 `__forwarding` 指向的还是它自己，即 `a->__forwarding` 获取到堆上的 `__block`，`a->__forwarding->a` 会把堆上的 `a` 赋值为 50。因此不管是栈上还是堆上的 `__block` 结构体，最终操作的都是堆上的 `__block` 结构体里面的数据。

#### __weak
Block 在捕获变量时，会保留其引用关系，也就是说如果使用 `__weak` 修饰外部变量，在内部生成 block 相关数据结构时，其存储的捕获变量也会带有该标记。

> 展开成 C++ 时遇到错误，原因是 `__weak` 是运行时支持的 
> ```objectivec
> cannot create __weak reference because the current deployment target does not support weak references
> ```
> 修改命令为 `xcrun -sdk iphoneos clang -arch arm64 -rewrite-objc -fobjc-arc -fobjc-runtime=ios-8.0.0 main.m` 即可

```objectivec
struct __main_block_impl_0 {
  struct __block_impl impl;
  struct __main_block_desc_0* Desc;
  Person *__weak weakP; /// 看这
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, Person *__weak _weakP, int flags=0) : weakP(_weakP) {
    impl.isa = &_NSConcreteStackBlock;
    impl.Flags = flags;
    impl.FuncPtr = fp;
    Desc = desc;
  }
};
```

#### __unsafe_unretained
原理上同 `__weak`

```objectivec
struct __main_block_impl_0 {
  struct __block_impl impl;
  struct __main_block_desc_0* Desc;
  Person *__unsafe_unretained p; /// 看这
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, Person *__unsafe_unretained _p, int flags=0) : p(_p) {
    impl.isa = &_NSConcreteStackBlock;
    impl.Flags = flags;
    impl.FuncPtr = fp;
    Desc = desc;
  }
};
```

#### __strong
默认情况下，对象的实例都是 `__strong` 修饰的，所以展开后的代码如下

```objectivec
struct __main_block_impl_0 {
  struct __block_impl impl;
  struct __main_block_desc_0* Desc;
  Person *__strong p; /// 看这
  __main_block_impl_0(void *fp, struct __main_block_desc_0 *desc, Person *__strong _p, int flags=0) : p(_p) {
    impl.isa = &_NSConcreteStackBlock;
    impl.Flags = flags;
    impl.FuncPtr = fp;
    Desc = desc;
  }
};
```

## 内存管理
这块也算是八股文里的重点了，因为 Block 在实际使用中，其特殊机制带来的影响，大家或多或少都踩过一下内存管理上的坑，所以有必要单独拿出来说说。

### 循环引用
> 你中有我，我中有你，两者不离不弃，至死不渝。
循环引用的场景不用多说，一句话表达就是两个及以上的对象互相强引用导致其无法正常析构的情况。常见的有 `delegate` 导致的循环引用问题，所以一般都使用 `weak` 修饰以避免。当然还有我们现在说的 Block，这也是重灾区。
### MRC
通过 `__unsafe_unretained` 和 `__block` 解决循环引用问题，通过上面大篇幅的介绍也能容器理解。在捕获变量的内部数据结构中，打破强引用链。这里单独说下 `__block`，在 MRC 模式下，捕获变量时不会对其 `retain`，这也是有别于 ARC 模式的情况。

### ARC
一般通过使用 `__weak` 修饰持有当前 Block 的外部变量，在 Block 作用域内再通过 `__strong` 修饰以获取当前作用域内相对持久的变量，继续执行后续逻辑。

```objectivec
__weak __typeof(self) weakSelf = self;
void (^exampleBlock)(void) = ^{
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    [strongSelf exampleFunc];
};
```

严格来讲，`weak strong dance` 并不算完美解法，更多的可能是为了在多层级 Block 嵌套式，能够让强弱引用的变量有一一对应的关系，增加可读性吧。而其不完美之处在于 Block 在被执行的过程中，同样存在外部变量 `self` 被提前释放的情况，这时候 `strongSelf` 可能就是 `nil`，因为原始值已经释放了。此时给这个变量发消息没问题，OC 的消息机制支持给空对象发消息，但是一旦涉及添加进数组等操作时，还是会 crash 的。所以还需要增加防护措施
```objectivec
__weak __typeof(self) weakSelf = self;
void (^exampleBlock)(void) = ^{
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    if (strongSelf) {
        // Add operation here
    }
};
```

## 扩展
`Block_layout` 结构体
- isa: 指向所属类的指针，也就是 Block 的类型
- flags: 按 bit 位表示一些 Block 的附加信息，比如判断 block 类型、判断 Block 引用计数、判断 block 是否需要执行辅助函数等；
- reserved: 保留变量；
- invoke: Block 函数指针，指向具体的 Block 实现的函数调用地址，Block 内部的执行代码都在这个函数中；
- descriptor: 结构体 Block_descriptor，Block 的附加描述信息，包含 copy/dispose 函数，Block 的大小，保留变量；
- variables: 因为 Block 有闭包性，所以可以访问 Block 外部的局部变量。这些 variables 就是复制到结构体中的外部局部变量或变量的地址；

`Block_descriptor` 结构体
- reserved: 保留变量；
- size: Block 的大小；
- copy: 函数用于捕获变量并持有引用；
- dispose: 析构函数，用来释放捕获的资源；
- signature: Block 的方法签名
- layout: Block 中有访问外部变量和对象，返回 `Block_descriptor_3` 的`layout` 信息

### 方法签名
对的，Block 同样有签名，装就装到底。获取的思路也很简单，就是造个和内部 `Block_layout` 一样的结构体，直接将 block 实例强转成改结构体，即可在 `descriptor` 中拿到对应签名。当然也需要结合对源码的阅读，增加必要的 `flags` 方面的判断，以减少异常情况。

### Hook
常见的就 3 种吧，只列举，不展开，资料一搜一大把。
1. 通过 `libffi` 直接对 Block 中的 `invoke` 下手。
2. 也是对 `invoke` 下手，通过设置其指针为 `_objc_msgForward`，这样在调用 Block 时就强制进入消息转发流程，再 hook 掉 `NSBlock` 的相关消息转发的方法，也还行吧。
3. 构造 hook block，然后强转成 `Block_layout` 结构体，替换双方的 invoke，也能勉强满足交换需求

# 后语
写到后面越写越水，这倒不是因为我懒（就是吧~），也是最近事务繁多，搞的我心力交瘁，成年人的世界哪有容易二字。

本篇通过对 Block 做了一些分析，除了常规性的技术总结之外，也算是为了日后八股文考试时能增加些自信心吧，分析过和没分析过还真就不一样。至于对个人水平和能力的体现，还是那句话，这 iOS 开发就那些东西，多少年了也没什么变化。