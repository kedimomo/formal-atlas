# ★7 Doop 级过程间指向：Andersen points-to on 半朴素引擎（spec，2026-06-07）

> 状态：**spec**。遵循 `06-frontier-map` §落地约束"动手做 ★X 须单独开 spec、走升级-回滚安全开关"。前置 **#5 已完成**——半朴素 Datalog 引擎(`src/verify/datalog.js`)正是 points-to 的底座(真 Doop = "用 Datalog 写 points-to、跑在快引擎上";上下文敏感 points-to 的事实爆炸只有半朴素扛得住)。本档定**第一刀**范围与设计,并把"多大野心"的抉择摆给用户。

## 一、要跨的边界（`06-frontier-map` §边界 #1）
当前调用解析是 **name-based**(`src/link/linker.js`:import 绑定 → 同文件 → 全局唯一 → extern),**看不见**:动态分派(`fn = cond?a:b; fn()`)、高阶/回调(`map(cb)`、`handlers[k]()`)、未知类型的方法调用、反射。后果:这些落进 `unresolved_call`(死代码安全网,牺牲精度)或被漏掉(污点经回调断流)。**#7 用 points-to 解析它们 → 死代码误报压到工业级、污点流过回调。**

## 二、方法：Andersen（包含式）points-to,写成 Datalog,跑半朴素引擎
Doop 的做法。抽取器新发基础关系:`alloc(Var,Obj)`(函数定义即一个函数对象;`{}`/`new` 即分配点)、`assign(To,From)`(赋值/传参/返回/闭包捕获)、`load/store`(字段,第二刀)、`calleeVar(Site,Var)`、`isFunction(Obj)`、`argActual(Site,I,A)`/`formalParam(F,I,P)`。核心不动点:
```
pts(V,O) :- alloc(V,O).
pts(To,O) :- assign(To,From), pts(From,O).
resolvedCall(Site,F) :- calleeVar(Site,V), pts(V,F), isFunction(F).       % 动态分派/高阶
assign(P,A) :- resolvedCall(Site,F), argActual(Site,I,A), formalParam(F,I,P). % 互递归:解析带来新流
```
`resolvedCall→assign` 的互递归正是 Doop 的不动点——半朴素天然处理(#5 已证传递闭包 33ms;points-to 同构,多关系而已)。

## 三、衔接（升级-回滚安全）
name-based 解析保留为基线;points-to **新增** `resolvedCall` 与 `rcall` 合流(`rcall(C,F):-resolvedCall(S,F),siteInCaller(S,C)`),静态直调结果**位等价**,只多解析原本 unresolved 的边。半朴素引擎加 `pts`/`resolvedCall` 不动点(扩成多关系)。**flag-gated `--points-to`**(默认关);开了才发 alloc/assign/... 跑 points-to。抽取层 `src/extract/points-to.js`(acorn AST:VariableDeclarator/AssignmentExpression/CallExpression/MemberExpression)。

## 四、范围与抉择（第一刀 = 最小可用）
**第一刀(建议)**:**字段不敏感 + 上下文不敏感** Andersen——所有字段并一个、所有调用点共享一份 pts;覆盖最高频的动态分派+高阶+回调污点。**后续刀(精度↑成本↑,需用户定野心)**:① 字段敏感(`o.a`≠`o.b`);② **上下文敏感**(k-CFA/object-sensitive,Doop 核心杠杆,事实爆炸——这才是 #5→#7 耦合的真因);③ JS 深水区(原型链、`this`、动态键 `o[k]`、`eval`/反射,边际递减)。
> **决策点(摆给用户)**:第一刀定在"字段+上下文均不敏感 Andersen",先解析出动态分派/高阶、measure 死代码/污点 FP 下降,再决定上不上字段/上下文敏感。不一上来追 Doop 全精度。

## 五、落地清单（增量,各自 parity 验证）
1. **核心引擎(本轮)**:`rules/points-to.pl`(Andersen 参考规则)+ `src/verify/datalog.js` 多关系半朴素 `pts`/`resolvedCall` 不动点 + 单测(小输入上 engine vs tau-prolog 逐位一致,如 ★5)。
2. **抽取(下一刀)**:`src/extract/points-to.js` 发 alloc/assign/calleeVar/isFunction/argActual/formalParam。
3. **link 合流**:`resolvedCall → rcall`(QId 化,复用 linker 解析序)。
4. **flag + 夹具**:`--points-to`;`examples/points-to/`(变量别名调用、高阶、dispatch table)验真阳,现有夹具验不回归。
5. **实测**:`routes`/`store/services` 上量 `unresolved_call`↓、死代码 FP↓、污点经回调新真阳;0 静态回归。

## 六、与大前沿序
#7 建在 #5(已完成)之上;#8(全 ITP 放电)在其后,points-to 精度直接喂 #8 的 VC。详见 `RESUME.md`(5→7→8)。
