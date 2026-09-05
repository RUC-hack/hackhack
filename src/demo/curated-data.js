(() => {
  "use strict";

  const sources = {
    "demo:zhihu:phd-or-work": {
      source_id: "demo:zhihu:phd-or-work",
      title: "读博和继续工作该怎么选？",
      author: "知乎公开答主",
      identity: "一位围绕在职申请、研究日常与机会成本给出具体建议的公开答主。页面不推断其现实身份。",
      summary: "这条回答没有把选择压缩成“年龄是否来得及”，而是建议先核验目标岗位是否真的需要博士，再用一段有限时间测试研究计划、导师匹配与自己对长期研究节奏的耐受度。",
      url: "https://www.zhihu.com/question/2067227711869826244/answer/2067738474992625078",
      content_type: "answer",
      provider: "demo",
      match_reasons: ["回应了读博的时间与机会成本", "把模糊焦虑拆成可验证的行动", "没有把博士当作逃离工作的自动答案"],
    },
    "demo:zhihu:career-choice": {
      source_id: "demo:zhihu:career-choice",
      title: "2022 年如何找到一份适合自己的工作？",
      author: "Jacob贾超",
      author_url: "https://www.zhihu.com/people/jia-chao-51",
      identity: "知乎职业发展话题答主。这里仅引用其公开回答里关于行业、公司与岗位选择维度的讨论。",
      summary: "这条回答把“找一份好工作”拆成行业、公司和岗位三个层次，并提醒选择要同时观察个人兴趣、能力匹配与真实的市场需求。",
      url: "https://www.zhihu.com/question/526469105/answer/2427259849",
      content_type: "answer",
      provider: "demo",
      match_reasons: ["提供了进入工作的具体观察维度", "强调岗位日常而不只看公司标签", "适合用来设计一段有边界的职业验证"],
    },
    "demo:zhihu:hometown": {
      source_id: "demo:zhihu:hometown",
      title: "你为什么选择留在郑州？",
      author: "379 位公开答主",
      identity: "一个讨论城市机会、生活成本、熟悉关系与个人适配度的知乎问题页。这里把它作为多声部讨论，而不是单一个案。",
      summary: "讨论中的经历提醒我们：城市选择不只是薪资和级别比较，还包括生活成本、关系网络、职业机会与自己在一座城市里的舒适程度。不同回答之间并没有统一结论。",
      url: "https://www.zhihu.com/question/327189160",
      content_type: "question",
      provider: "demo",
      match_reasons: ["把家乡从抽象退路变成具体生活", "保留了多位答主彼此不同的城市经验", "提醒同时比较机会密度与完整生活"],
    },
  };

  const answer = {
    summary: "你面对的不是一道必须一次押对的终局题，而是三种不同的验证方式。先辨认自己想过的日常，再决定下一段两三年把什么放在前面。",
    sections: [
      {
        kind: "path",
        title: "把读博变成一次可验证的研究生活",
        content: "先不问“博士是不是更好的标签”，而是验证三个更具体的问题：目标岗位是否真的需要博士、你是否愿意长期面对低反馈的研究日常、现实现金流能否支撑。可以先用 6—8 周完成一份小型研究计划，并和真实导师或在读博士交流，再决定是否申请。",
        source_ids: ["demo:zhihu:phd-or-work"],
      },
      {
        kind: "path",
        title: "先进入工作，用两年看清自己的反馈偏好",
        content: "先工作不等于永远告别研究。把第一份工作当作有期限的验证：观察自己是否喜欢团队协作、快速交付和业务反馈，同时保留学习记录与申请材料。比起只看“大厂”标签，更值得比较的是具体岗位、直属团队和每天会做的事。",
        source_ids: ["demo:zhihu:career-choice"],
      },
      {
        kind: "path",
        title: "把家乡放回一张完整的生活地图",
        content: "回家乡不必被理解为退路。把当地岗位、收入与成本、家庭距离、关系网络和未来流动性放在同一张表里；如果岗位还不明确，可以先访谈三位已经回去的人，确认真实日常后再做决定。",
        source_ids: ["demo:zhihu:hometown"],
      },
    ],
    assumptions: ["你仍然愿意了解科研与产业两种生活", "这三条路目前都没有不可逆的现实限制"],
    unknowns: ["你对研究日常的真实体验", "三个选项对应的具体岗位与经济条件"],
    limitations: ["这份整理提供的是人生参照，不是对个人处境的自动判断。", "公开回答只代表有限个体经验，链接内容也可能在知乎侧发生变化。"],
    next_actions: ["分别找一位在读博士、入行两年的人和已回家乡的人，询问他们普通一天的具体安排。", "用同一张表记录三条路径的现金流、时间投入、可逆性和最担心的代价。"],
  };

  window.JIANZHONG_CURATED_DATA = Object.freeze({
    sources: Object.freeze(sources),
    answer: Object.freeze(answer),
  });
})();
