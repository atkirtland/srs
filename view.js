(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/ts-fsrs/dist/index.mjs
  var State = /* @__PURE__ */ ((State2) => {
    State2[State2["New"] = 0] = "New";
    State2[State2["Learning"] = 1] = "Learning";
    State2[State2["Review"] = 2] = "Review";
    State2[State2["Relearning"] = 3] = "Relearning";
    return State2;
  })(State || {});
  var Rating = /* @__PURE__ */ ((Rating2) => {
    Rating2[Rating2["Manual"] = 0] = "Manual";
    Rating2[Rating2["Again"] = 1] = "Again";
    Rating2[Rating2["Hard"] = 2] = "Hard";
    Rating2[Rating2["Good"] = 3] = "Good";
    Rating2[Rating2["Easy"] = 4] = "Easy";
    return Rating2;
  })(Rating || {});
  var TypeConvert = class _TypeConvert {
    static card(card) {
      return {
        ...card,
        state: _TypeConvert.state(card.state),
        due: _TypeConvert.time(card.due),
        last_review: card.last_review ? _TypeConvert.time(card.last_review) : void 0
      };
    }
    static rating(value) {
      if (typeof value === "string") {
        const firstLetter = value.charAt(0).toUpperCase();
        const restOfString = value.slice(1).toLowerCase();
        const ret = Rating[`${firstLetter}${restOfString}`];
        if (ret === void 0) {
          throw new Error(`Invalid rating:[${value}]`);
        }
        return ret;
      } else if (typeof value === "number") {
        return value;
      }
      throw new Error(`Invalid rating:[${value}]`);
    }
    static state(value) {
      if (typeof value === "string") {
        const firstLetter = value.charAt(0).toUpperCase();
        const restOfString = value.slice(1).toLowerCase();
        const ret = State[`${firstLetter}${restOfString}`];
        if (ret === void 0) {
          throw new Error(`Invalid state:[${value}]`);
        }
        return ret;
      } else if (typeof value === "number") {
        return value;
      }
      throw new Error(`Invalid state:[${value}]`);
    }
    static time(value) {
      const date = new Date(value);
      if (typeof value === "object" && value !== null && !Number.isNaN(Date.parse(value) || +date)) {
        return date;
      } else if (typeof value === "string") {
        const timestamp = Date.parse(value);
        if (!Number.isNaN(timestamp)) {
          return new Date(timestamp);
        } else {
          throw new Error(`Invalid date:[${value}]`);
        }
      } else if (typeof value === "number") {
        return new Date(value);
      }
      throw new Error(`Invalid date:[${value}]`);
    }
    static review_log(log) {
      return {
        ...log,
        due: _TypeConvert.time(log.due),
        rating: _TypeConvert.rating(log.rating),
        state: _TypeConvert.state(log.state),
        review: _TypeConvert.time(log.review)
      };
    }
  };
  Date.prototype.scheduler = function(t, isDay) {
    return date_scheduler(this, t, isDay);
  };
  Date.prototype.diff = function(pre, unit) {
    return date_diff(this, pre, unit);
  };
  Date.prototype.format = function() {
    return formatDate(this);
  };
  Date.prototype.dueFormat = function(last_review, unit, timeUnit) {
    return show_diff_message(this, last_review, unit, timeUnit);
  };
  function date_scheduler(now, t, isDay) {
    return new Date(
      isDay ? TypeConvert.time(now).getTime() + t * 24 * 60 * 60 * 1e3 : TypeConvert.time(now).getTime() + t * 60 * 1e3
    );
  }
  function date_diff(now, pre, unit) {
    if (!now || !pre) {
      throw new Error("Invalid date");
    }
    const diff = TypeConvert.time(now).getTime() - TypeConvert.time(pre).getTime();
    let r = 0;
    switch (unit) {
      case "days":
        r = Math.floor(diff / (24 * 60 * 60 * 1e3));
        break;
      case "minutes":
        r = Math.floor(diff / (60 * 1e3));
        break;
    }
    return r;
  }
  function formatDate(dateInput) {
    const date = TypeConvert.time(dateInput);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return `${year}-${padZero(month)}-${padZero(day)} ${padZero(hours)}:${padZero(
      minutes
    )}:${padZero(seconds)}`;
  }
  function padZero(num) {
    return num < 10 ? `0${num}` : `${num}`;
  }
  var TIMEUNIT = [60, 60, 24, 31, 12];
  var TIMEUNITFORMAT = ["second", "min", "hour", "day", "month", "year"];
  function show_diff_message(due, last_review, unit, timeUnit = TIMEUNITFORMAT) {
    due = TypeConvert.time(due);
    last_review = TypeConvert.time(last_review);
    if (timeUnit.length !== TIMEUNITFORMAT.length) {
      timeUnit = TIMEUNITFORMAT;
    }
    let diff = due.getTime() - last_review.getTime();
    let i = 0;
    diff /= 1e3;
    for (i = 0; i < TIMEUNIT.length; i++) {
      if (diff < TIMEUNIT[i]) {
        break;
      } else {
        diff /= TIMEUNIT[i];
      }
    }
    return `${Math.floor(diff)}${unit ? timeUnit[i] : ""}`;
  }
  var Grades = Object.freeze([
    Rating.Again,
    Rating.Hard,
    Rating.Good,
    Rating.Easy
  ]);
  var FUZZ_RANGES = [
    {
      start: 2.5,
      end: 7,
      factor: 0.15
    },
    {
      start: 7,
      end: 20,
      factor: 0.1
    },
    {
      start: 20,
      end: Infinity,
      factor: 0.05
    }
  ];
  function get_fuzz_range(interval, elapsed_days, maximum_interval) {
    let delta = 1;
    for (const range of FUZZ_RANGES) {
      delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
    }
    interval = Math.min(interval, maximum_interval);
    let min_ivl = Math.max(2, Math.round(interval - delta));
    const max_ivl = Math.min(Math.round(interval + delta), maximum_interval);
    if (interval > elapsed_days) {
      min_ivl = Math.max(min_ivl, elapsed_days + 1);
    }
    min_ivl = Math.min(min_ivl, max_ivl);
    return { min_ivl, max_ivl };
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function dateDiffInDays(last, cur) {
    const utc1 = Date.UTC(
      last.getUTCFullYear(),
      last.getUTCMonth(),
      last.getUTCDate()
    );
    const utc2 = Date.UTC(
      cur.getUTCFullYear(),
      cur.getUTCMonth(),
      cur.getUTCDate()
    );
    return Math.floor(
      (utc2 - utc1) / 864e5
      /** 1000 * 60 * 60 * 24*/
    );
  }
  var ConvertStepUnitToMinutes = (step) => {
    const unit = step.slice(-1);
    const value = parseInt(step.slice(0, -1), 10);
    if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid step value: ${step}`);
    }
    switch (unit) {
      case "m":
        return value;
      case "h":
        return value * 60;
      case "d":
        return value * 1440;
      default:
        throw new Error(`Invalid step unit: ${step}, expected m/h/d`);
    }
  };
  var BasicLearningStepsStrategy = (params, state, cur_step) => {
    const learning_steps = state === State.Relearning || state === State.Review ? params.relearning_steps : params.learning_steps;
    const steps_length = learning_steps.length;
    if (steps_length === 0 || cur_step >= steps_length) return {};
    const firstStep = learning_steps[0];
    const toMinutes = ConvertStepUnitToMinutes;
    const getAgainInterval = () => {
      return toMinutes(firstStep);
    };
    const getHardInterval = () => {
      if (steps_length === 1) return Math.round(toMinutes(firstStep) * 1.5);
      const nextStep = learning_steps[1];
      return Math.round((toMinutes(firstStep) + toMinutes(nextStep)) / 2);
    };
    const getStepInfo = (index) => {
      if (index < 0 || index >= steps_length) {
        return null;
      } else {
        return learning_steps[index];
      }
    };
    const getGoodMinutes = (step) => {
      return toMinutes(step);
    };
    const result = {};
    const step_info = getStepInfo(Math.max(0, cur_step));
    if (state === State.Review) {
      result[Rating.Again] = {
        scheduled_minutes: toMinutes(step_info),
        next_step: 0
      };
      return result;
    } else {
      result[Rating.Again] = {
        scheduled_minutes: getAgainInterval(),
        next_step: 0
      };
      result[Rating.Hard] = {
        scheduled_minutes: getHardInterval(),
        next_step: cur_step
      };
      const next_info = getStepInfo(cur_step + 1);
      if (next_info) {
        const nextMin = getGoodMinutes(next_info);
        if (nextMin) {
          result[Rating.Good] = {
            scheduled_minutes: Math.round(nextMin),
            next_step: cur_step + 1
          };
        }
      }
    }
    return result;
  };
  function DefaultInitSeedStrategy() {
    const time = this.review_time.getTime();
    const reps = this.current.reps;
    const mul = this.current.difficulty * this.current.stability;
    return `${time}_${reps}_${mul}`;
  }
  var StrategyMode = /* @__PURE__ */ ((StrategyMode2) => {
    StrategyMode2["SCHEDULER"] = "Scheduler";
    StrategyMode2["LEARNING_STEPS"] = "LearningSteps";
    StrategyMode2["SEED"] = "Seed";
    return StrategyMode2;
  })(StrategyMode || {});
  var AbstractScheduler = class {
    // init
    constructor(card, now, algorithm, strategies) {
      __publicField(this, "last");
      __publicField(this, "current");
      __publicField(this, "review_time");
      __publicField(this, "next", /* @__PURE__ */ new Map());
      __publicField(this, "algorithm");
      __publicField(this, "strategies");
      __publicField(this, "elapsed_days", 0);
      this.algorithm = algorithm;
      this.last = TypeConvert.card(card);
      this.current = TypeConvert.card(card);
      this.review_time = TypeConvert.time(now);
      this.strategies = strategies;
      this.init();
    }
    checkGrade(grade) {
      if (!Number.isFinite(grade) || grade < 0 || grade > 4) {
        throw new Error(`Invalid grade "${grade}",expected 1-4`);
      }
    }
    init() {
      const { state, last_review } = this.current;
      let interval = 0;
      if (state !== State.New && last_review) {
        interval = dateDiffInDays(last_review, this.review_time);
      }
      this.current.last_review = this.review_time;
      this.elapsed_days = interval;
      this.current.elapsed_days = interval;
      this.current.reps += 1;
      let seed_strategy = DefaultInitSeedStrategy;
      if (this.strategies) {
        const custom_strategy = this.strategies.get(StrategyMode.SEED);
        if (custom_strategy) {
          seed_strategy = custom_strategy;
        }
      }
      this.algorithm.seed = seed_strategy.call(this);
    }
    preview() {
      return {
        [Rating.Again]: this.review(Rating.Again),
        [Rating.Hard]: this.review(Rating.Hard),
        [Rating.Good]: this.review(Rating.Good),
        [Rating.Easy]: this.review(Rating.Easy),
        [Symbol.iterator]: this.previewIterator.bind(this)
      };
    }
    *previewIterator() {
      for (const grade of Grades) {
        yield this.review(grade);
      }
    }
    review(grade) {
      const { state } = this.last;
      let item;
      this.checkGrade(grade);
      switch (state) {
        case State.New:
          item = this.newState(grade);
          break;
        case State.Learning:
        case State.Relearning:
          item = this.learningState(grade);
          break;
        case State.Review:
          item = this.reviewState(grade);
          break;
      }
      return item;
    }
    buildLog(rating) {
      const { last_review, due, elapsed_days } = this.last;
      return {
        rating,
        state: this.current.state,
        due: last_review || due,
        stability: this.current.stability,
        difficulty: this.current.difficulty,
        elapsed_days: this.elapsed_days,
        last_elapsed_days: elapsed_days,
        scheduled_days: this.current.scheduled_days,
        learning_steps: this.current.learning_steps,
        review: this.review_time
      };
    }
  };
  var Alea = class {
    constructor(seed) {
      __publicField(this, "c");
      __publicField(this, "s0");
      __publicField(this, "s1");
      __publicField(this, "s2");
      const mash = Mash();
      this.c = 1;
      this.s0 = mash(" ");
      this.s1 = mash(" ");
      this.s2 = mash(" ");
      if (seed == null) seed = Date.now();
      this.s0 -= mash(seed);
      if (this.s0 < 0) this.s0 += 1;
      this.s1 -= mash(seed);
      if (this.s1 < 0) this.s1 += 1;
      this.s2 -= mash(seed);
      if (this.s2 < 0) this.s2 += 1;
    }
    next() {
      const t = 2091639 * this.s0 + this.c * 23283064365386963e-26;
      this.s0 = this.s1;
      this.s1 = this.s2;
      this.c = t | 0;
      this.s2 = t - this.c;
      return this.s2;
    }
    set state(state) {
      this.c = state.c;
      this.s0 = state.s0;
      this.s1 = state.s1;
      this.s2 = state.s2;
    }
    get state() {
      return {
        c: this.c,
        s0: this.s0,
        s1: this.s1,
        s2: this.s2
      };
    }
  };
  function Mash() {
    let n = 4022871197;
    return function mash(data) {
      data = String(data);
      for (let i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        let h = 0.02519603282416938 * n;
        n = h >>> 0;
        h -= n;
        h *= n;
        n = h >>> 0;
        h -= n;
        n += h * 4294967296;
      }
      return (n >>> 0) * 23283064365386963e-26;
    };
  }
  function alea(seed) {
    const xg = new Alea(seed);
    const prng = () => xg.next();
    prng.int32 = () => xg.next() * 4294967296 | 0;
    prng.double = () => prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
    prng.state = () => xg.state;
    prng.importState = (state) => {
      xg.state = state;
      return prng;
    };
    return prng;
  }
  var version = "5.2.3";
  var default_request_retention = 0.9;
  var default_maximum_interval = 36500;
  var default_enable_fuzz = false;
  var default_enable_short_term = true;
  var default_learning_steps = Object.freeze([
    "1m",
    "10m"
  ]);
  var default_relearning_steps = Object.freeze([
    "10m"
  ]);
  var FSRSVersion = `v${version} using FSRS-6.0`;
  var S_MIN = 1e-3;
  var INIT_S_MAX = 100;
  var FSRS5_DEFAULT_DECAY = 0.5;
  var FSRS6_DEFAULT_DECAY = 0.1542;
  var default_w = Object.freeze([
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    1e-3,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    FSRS6_DEFAULT_DECAY
  ]);
  var W17_W18_Ceiling = 2;
  var CLAMP_PARAMETERS = (w17_w18_ceiling, enable_short_term = default_enable_short_term) => [
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [1, 10],
    [1e-3, 4],
    [1e-3, 4],
    [1e-3, 0.75],
    [0, 4.5],
    [0, 0.8],
    [1e-3, 3.5],
    [1e-3, 5],
    [1e-3, 0.25],
    [1e-3, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, w17_w18_ceiling],
    [0, w17_w18_ceiling],
    [
      enable_short_term ? 0.01 : 0,
      0.8
    ],
    [0.1, 0.8]
  ];
  var clipParameters = (parameters, numRelearningSteps, enableShortTerm = default_enable_short_term) => {
    let w17_w18_ceiling = W17_W18_Ceiling;
    if (Math.max(0, numRelearningSteps) > 1) {
      const value = -(Math.log(parameters[11]) + Math.log(Math.pow(2, parameters[13]) - 1) + parameters[14] * 0.3) / numRelearningSteps;
      w17_w18_ceiling = clamp(+value.toFixed(8), 0.01, 2);
    }
    const clip = CLAMP_PARAMETERS(w17_w18_ceiling, enableShortTerm).slice(
      0,
      parameters.length
    );
    return clip.map(
      ([min, max], index) => clamp(parameters[index] || 0, min, max)
    );
  };
  var migrateParameters = (parameters, numRelearningSteps = 0, enableShortTerm = default_enable_short_term) => {
    if (parameters === void 0) {
      return [...default_w];
    }
    switch (parameters.length) {
      case 21:
        return clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        );
      case 19:
        console.debug("[FSRS-6]auto fill w from 19 to 21 length");
        return clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        ).concat([0, FSRS5_DEFAULT_DECAY]);
      case 17: {
        const w = clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        );
        w[4] = +(w[5] * 2 + w[4]).toFixed(8);
        w[5] = +(Math.log(w[5] * 3 + 1) / 3).toFixed(8);
        w[6] = +(w[6] + 0.5).toFixed(8);
        console.debug("[FSRS-6]auto fill w from 17 to 21 length");
        return w.concat([0, 0, 0, FSRS5_DEFAULT_DECAY]);
      }
      default:
        console.warn("[FSRS]Invalid parameters length, using default parameters");
        return [...default_w];
    }
  };
  var generatorParameters = (props) => {
    const learning_steps = Array.isArray(props?.learning_steps) ? props.learning_steps : default_learning_steps;
    const relearning_steps = Array.isArray(props?.relearning_steps) ? props.relearning_steps : default_relearning_steps;
    const enable_short_term = props?.enable_short_term ?? default_enable_short_term;
    const w = migrateParameters(
      props?.w,
      relearning_steps.length,
      enable_short_term
    );
    return {
      request_retention: props?.request_retention || default_request_retention,
      maximum_interval: props?.maximum_interval || default_maximum_interval,
      w,
      enable_fuzz: props?.enable_fuzz ?? default_enable_fuzz,
      enable_short_term,
      learning_steps,
      relearning_steps
    };
  };
  function createEmptyCard(now, afterHandler) {
    const emptyCard = {
      due: now ? TypeConvert.time(now) : /* @__PURE__ */ new Date(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      learning_steps: 0,
      state: State.New,
      last_review: void 0
    };
    if (afterHandler && typeof afterHandler === "function") {
      return afterHandler(emptyCard);
    } else {
      return emptyCard;
    }
  }
  var computeDecayFactor = (decayOrParams) => {
    const decay = typeof decayOrParams === "number" ? -decayOrParams : -decayOrParams[20];
    const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
    return { decay, factor: +factor.toFixed(8) };
  };
  function forgetting_curve(decayOrParams, elapsed_days, stability) {
    const { decay, factor } = computeDecayFactor(decayOrParams);
    return +Math.pow(1 + factor * elapsed_days / stability, decay).toFixed(8);
  }
  var FSRSAlgorithm = class {
    constructor(params) {
      __publicField(this, "param");
      __publicField(this, "intervalModifier");
      __publicField(this, "_seed");
      /**
       * The formula used is :
       * $$R(t,S) = (1 + \text{FACTOR} \times \frac{t}{9 \cdot S})^{\text{DECAY}}$$
       * @param {number} elapsed_days t days since the last review
       * @param {number} stability Stability (interval when R=90%)
       * @return {number} r Retrievability (probability of recall)
       */
      __publicField(this, "forgetting_curve");
      this.param = new Proxy(
        generatorParameters(params),
        this.params_handler_proxy()
      );
      this.intervalModifier = this.calculate_interval_modifier(
        this.param.request_retention
      );
      this.forgetting_curve = forgetting_curve.bind(this, this.param.w);
    }
    get interval_modifier() {
      return this.intervalModifier;
    }
    set seed(seed) {
      this._seed = seed;
    }
    /**
     * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm#fsrs-5
     *
     * The formula used is: $$I(r,s) = (r^{\frac{1}{DECAY}} - 1) / FACTOR \times s$$
     * @param request_retention 0<request_retention<=1,Requested retention rate
     * @throws {Error} Requested retention rate should be in the range (0,1]
     */
    calculate_interval_modifier(request_retention) {
      if (request_retention <= 0 || request_retention > 1) {
        throw new Error("Requested retention rate should be in the range (0,1]");
      }
      const { decay, factor } = computeDecayFactor(this.param.w);
      return +((Math.pow(request_retention, 1 / decay) - 1) / factor).toFixed(8);
    }
    /**
     * Get the parameters of the algorithm.
     */
    get parameters() {
      return this.param;
    }
    /**
     * Set the parameters of the algorithm.
     * @param params Partial<FSRSParameters>
     */
    set parameters(params) {
      this.update_parameters(params);
    }
    params_handler_proxy() {
      const _this = this;
      return {
        set: function(target, prop, value) {
          if (prop === "request_retention" && Number.isFinite(value)) {
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(value)
            );
          } else if (prop === "w") {
            value = migrateParameters(
              value,
              target.relearning_steps.length,
              target.enable_short_term
            );
            _this.forgetting_curve = forgetting_curve.bind(this, value);
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(target.request_retention)
            );
          }
          Reflect.set(target, prop, value);
          return true;
        }
      };
    }
    update_parameters(params) {
      const _params = generatorParameters(params);
      for (const key in _params) {
        const paramKey = key;
        this.param[paramKey] = _params[paramKey];
      }
    }
    /**
       * The formula used is :
       * $$ S_0(G) = w_{G-1}$$
       * $$S_0 = \max \lbrace S_0,0.1\rbrace $$
    
       * @param g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
       * @return Stability (interval when R=90%)
       */
    init_stability(g) {
      return Math.max(this.param.w[g - 1], 0.1);
    }
    /**
     * The formula used is :
     * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1 $$
     * $$D_0 = \min \lbrace \max \lbrace D_0(G),1 \rbrace,10 \rbrace$$
     * where the $$D_0(1)=w_4$$ when the first rating is good.
     *
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} Difficulty $$D \in [1,10]$$
     */
    init_difficulty(g) {
      const d = this.param.w[4] - Math.exp((g - 1) * this.param.w[5]) + 1;
      return +d.toFixed(8);
    }
    /**
     * If fuzzing is disabled or ivl is less than 2.5, it returns the original interval.
     * @param {number} ivl - The interval to be fuzzed.
     * @param {number} elapsed_days t days since the last review
     * @return {number} - The fuzzed interval.
     **/
    apply_fuzz(ivl, elapsed_days) {
      if (!this.param.enable_fuzz || ivl < 2.5) return Math.round(ivl);
      const generator = alea(this._seed);
      const fuzz_factor = generator();
      const { min_ivl, max_ivl } = get_fuzz_range(
        ivl,
        elapsed_days,
        this.param.maximum_interval
      );
      return Math.floor(fuzz_factor * (max_ivl - min_ivl + 1) + min_ivl);
    }
    /**
     *   @see The formula used is : {@link FSRSAlgorithm.calculate_interval_modifier}
     *   @param {number} s - Stability (interval when R=90%)
     *   @param {number} elapsed_days t days since the last review
     */
    next_interval(s, elapsed_days) {
      const newInterval = Math.min(
        Math.max(1, Math.round(s * this.intervalModifier)),
        this.param.maximum_interval
      );
      return this.apply_fuzz(newInterval, elapsed_days);
    }
    /**
     * @see https://github.com/open-spaced-repetition/fsrs4anki/issues/697
     */
    linear_damping(delta_d, old_d) {
      return +(delta_d * (10 - old_d) / 9).toFixed(8);
    }
    /**
     * The formula used is :
     * $$\text{delta}_d = -w_6 \cdot (g - 3)$$
     * $$\text{next}_d = D + \text{linear damping}(\text{delta}_d , D)$$
     * $$D^\prime(D,R) = w_7 \cdot D_0(4) +(1 - w_7) \cdot \text{next}_d$$
     * @param {number} d Difficulty $$D \in [1,10]$$
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} $$\text{next}_D$$
     */
    next_difficulty(d, g) {
      const delta_d = -this.param.w[6] * (g - 3);
      const next_d = d + this.linear_damping(delta_d, d);
      return clamp(
        this.mean_reversion(this.init_difficulty(Rating.Easy), next_d),
        1,
        10
      );
    }
    /**
     * The formula used is :
     * $$w_7 \cdot \text{init} +(1 - w_7) \cdot \text{current}$$
     * @param {number} init $$w_2 : D_0(3) = w_2 + (R-2) \cdot w_3= w_2$$
     * @param {number} current $$D - w_6 \cdot (R - 2)$$
     * @return {number} difficulty
     */
    mean_reversion(init, current) {
      return +(this.param.w[7] * init + (1 - this.param.w[7]) * current).toFixed(
        8
      );
    }
    /**
     * The formula used is :
     * $$S^\prime_r(D,S,R,G) = S\cdot(e^{w_8}\cdot (11-D)\cdot S^{-w_9}\cdot(e^{w_{10}\cdot(1-R)}-1)\cdot w_{15}(\text{if} G=2) \cdot w_{16}(\text{if} G=4)+1)$$
     * @param {number} d Difficulty D \in [1,10]
     * @param {number} s Stability (interval when R=90%)
     * @param {number} r Retrievability (probability of recall)
     * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
     * @return {number} S^\prime_r new stability after recall
     */
    next_recall_stability(d, s, r, g) {
      const hard_penalty = Rating.Hard === g ? this.param.w[15] : 1;
      const easy_bound = Rating.Easy === g ? this.param.w[16] : 1;
      return +clamp(
        s * (1 + Math.exp(this.param.w[8]) * (11 - d) * Math.pow(s, -this.param.w[9]) * (Math.exp((1 - r) * this.param.w[10]) - 1) * hard_penalty * easy_bound),
        S_MIN,
        36500
      ).toFixed(8);
    }
    /**
     * The formula used is :
     * $$S^\prime_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot ((S+1)^{w_{13}}-1) \cdot e^{w_{14}\cdot(1-R)}$$
     * enable_short_term = true : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, \frac{S}{e^{w_{17} \cdot w_{18}}} \rbrace$$
     * enable_short_term = false : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, S \rbrace$$
     * @param {number} d Difficulty D \in [1,10]
     * @param {number} s Stability (interval when R=90%)
     * @param {number} r Retrievability (probability of recall)
     * @return {number} S^\prime_f new stability after forgetting
     */
    next_forget_stability(d, s, r) {
      return +clamp(
        this.param.w[11] * Math.pow(d, -this.param.w[12]) * (Math.pow(s + 1, this.param.w[13]) - 1) * Math.exp((1 - r) * this.param.w[14]),
        S_MIN,
        36500
      ).toFixed(8);
    }
    /**
     * The formula used is :
     * $$S^\prime_s(S,G) = S \cdot e^{w_{17} \cdot (G-3+w_{18})}$$
     * @param {number} s Stability (interval when R=90%)
     * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
     */
    next_short_term_stability(s, g) {
      const sinc = Math.pow(s, -this.param.w[19]) * Math.exp(this.param.w[17] * (g - 3 + this.param.w[18]));
      const maskedSinc = g >= 3 ? Math.max(sinc, 1) : sinc;
      return +clamp(s * maskedSinc, S_MIN, 36500).toFixed(8);
    }
    /**
     * Calculates the next state of memory based on the current state, time elapsed, and grade.
     *
     * @param memory_state - The current state of memory, which can be null.
     * @param t - The time elapsed since the last review.
     * @param {Rating} g Grade (Rating[0.Manual,1.Again,2.Hard,3.Good,4.Easy])
     * @returns The next state of memory with updated difficulty and stability.
     */
    next_state(memory_state, t, g) {
      const { difficulty: d, stability: s } = memory_state ?? {
        difficulty: 0,
        stability: 0
      };
      if (t < 0) {
        throw new Error(`Invalid delta_t "${t}"`);
      }
      if (g < 0 || g > 4) {
        throw new Error(`Invalid grade "${g}"`);
      }
      if (d === 0 && s === 0) {
        return {
          difficulty: clamp(this.init_difficulty(g), 1, 10),
          stability: this.init_stability(g)
        };
      }
      if (g === 0) {
        return {
          difficulty: d,
          stability: s
        };
      }
      if (d < 1 || s < S_MIN) {
        throw new Error(
          `Invalid memory state { difficulty: ${d}, stability: ${s} }`
        );
      }
      const r = this.forgetting_curve(t, s);
      const s_after_success = this.next_recall_stability(d, s, r, g);
      const s_after_fail = this.next_forget_stability(d, s, r);
      const s_after_short_term = this.next_short_term_stability(s, g);
      let new_s = s_after_success;
      if (g === 1) {
        let [w_17, w_18] = [0, 0];
        if (this.param.enable_short_term) {
          w_17 = this.param.w[17];
          w_18 = this.param.w[18];
        }
        const next_s_min = s / Math.exp(w_17 * w_18);
        new_s = clamp(+next_s_min.toFixed(8), S_MIN, s_after_fail);
      }
      if (t === 0 && this.param.enable_short_term) {
        new_s = s_after_short_term;
      }
      const new_d = this.next_difficulty(d, g);
      return { difficulty: new_d, stability: new_s };
    }
  };
  var BasicScheduler = class extends AbstractScheduler {
    constructor(card, now, algorithm, strategies) {
      super(card, now, algorithm, strategies);
      __publicField(this, "learningStepsStrategy");
      let learningStepStrategy = BasicLearningStepsStrategy;
      if (this.strategies) {
        const custom_strategy = this.strategies.get(StrategyMode.LEARNING_STEPS);
        if (custom_strategy) {
          learningStepStrategy = custom_strategy;
        }
      }
      this.learningStepsStrategy = learningStepStrategy;
    }
    getLearningInfo(card, grade) {
      const parameters = this.algorithm.parameters;
      card.learning_steps = card.learning_steps || 0;
      const steps_strategy = this.learningStepsStrategy(
        parameters,
        card.state,
        // In the original learning steps setup (Again = 5m, Hard = 10m, Good = FSRS),
        // not adding 1 can cause slight variations in the memory state’s ds.
        this.current.state === State.Learning && grade !== Rating.Again && grade !== Rating.Hard ? card.learning_steps + 1 : card.learning_steps
      );
      const scheduled_minutes = Math.max(
        0,
        steps_strategy[grade]?.scheduled_minutes ?? 0
      );
      const next_steps = Math.max(0, steps_strategy[grade]?.next_step ?? 0);
      return {
        scheduled_minutes,
        next_steps
      };
    }
    /**
     * @description This function applies the learning steps based on the current card's state and grade.
     */
    applyLearningSteps(nextCard, grade, to_state) {
      const { scheduled_minutes, next_steps } = this.getLearningInfo(
        this.current,
        grade
      );
      if (scheduled_minutes > 0 && scheduled_minutes < 1440) {
        nextCard.learning_steps = next_steps;
        nextCard.scheduled_days = 0;
        nextCard.state = to_state;
        nextCard.due = date_scheduler(
          this.review_time,
          Math.round(scheduled_minutes),
          false
          /** true:days false: minute */
        );
      } else {
        nextCard.state = State.Review;
        if (scheduled_minutes >= 1440) {
          nextCard.learning_steps = next_steps;
          nextCard.due = date_scheduler(
            this.review_time,
            Math.round(scheduled_minutes),
            false
            /** true:days false: minute */
          );
          nextCard.scheduled_days = Math.floor(scheduled_minutes / 1440);
        } else {
          nextCard.learning_steps = 0;
          const interval = this.algorithm.next_interval(
            nextCard.stability,
            this.elapsed_days
          );
          nextCard.scheduled_days = interval;
          nextCard.due = date_scheduler(this.review_time, interval, true);
        }
      }
    }
    newState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const next = TypeConvert.card(this.current);
      next.difficulty = clamp(this.algorithm.init_difficulty(grade), 1, 10);
      next.stability = this.algorithm.init_stability(grade);
      this.applyLearningSteps(next, grade, State.Learning);
      const item = {
        card: next,
        log: this.buildLog(grade)
      };
      this.next.set(grade, item);
      return item;
    }
    learningState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const { state, difficulty, stability } = this.last;
      const next = TypeConvert.card(this.current);
      next.difficulty = this.algorithm.next_difficulty(difficulty, grade);
      next.stability = this.algorithm.next_short_term_stability(stability, grade);
      this.applyLearningSteps(
        next,
        grade,
        state
        /** Learning or Relearning */
      );
      const item = {
        card: next,
        log: this.buildLog(grade)
      };
      this.next.set(grade, item);
      return item;
    }
    reviewState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const interval = this.elapsed_days;
      const { difficulty, stability } = this.last;
      const retrievability = this.algorithm.forgetting_curve(interval, stability);
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.next_ds(
        next_again,
        next_hard,
        next_good,
        next_easy,
        difficulty,
        stability,
        retrievability
      );
      this.next_interval(next_hard, next_good, next_easy, interval);
      this.next_state(next_hard, next_good, next_easy);
      this.applyLearningSteps(next_again, Rating.Again, State.Relearning);
      next_again.lapses += 1;
      const item_again = {
        card: next_again,
        log: this.buildLog(Rating.Again)
      };
      const item_hard = {
        card: next_hard,
        log: super.buildLog(Rating.Hard)
      };
      const item_good = {
        card: next_good,
        log: super.buildLog(Rating.Good)
      };
      const item_easy = {
        card: next_easy,
        log: super.buildLog(Rating.Easy)
      };
      this.next.set(Rating.Again, item_again);
      this.next.set(Rating.Hard, item_hard);
      this.next.set(Rating.Good, item_good);
      this.next.set(Rating.Easy, item_easy);
      return this.next.get(grade);
    }
    /**
     * Review next_ds
     */
    next_ds(next_again, next_hard, next_good, next_easy, difficulty, stability, retrievability) {
      next_again.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Again
      );
      const nextSMin = stability / Math.exp(
        this.algorithm.parameters.w[17] * this.algorithm.parameters.w[18]
      );
      const s_after_fail = this.algorithm.next_forget_stability(
        difficulty,
        stability,
        retrievability
      );
      next_again.stability = clamp(+nextSMin.toFixed(8), S_MIN, s_after_fail);
      next_hard.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Hard
      );
      next_hard.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Hard
      );
      next_good.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Good
      );
      next_good.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Good
      );
      next_easy.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Easy
      );
      next_easy.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Easy
      );
    }
    /**
     * Review next_interval
     */
    next_interval(next_hard, next_good, next_easy, interval) {
      let hard_interval, good_interval;
      hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
      good_interval = this.algorithm.next_interval(next_good.stability, interval);
      hard_interval = Math.min(hard_interval, good_interval);
      good_interval = Math.max(good_interval, hard_interval + 1);
      const easy_interval = Math.max(
        this.algorithm.next_interval(next_easy.stability, interval),
        good_interval + 1
      );
      next_hard.scheduled_days = hard_interval;
      next_hard.due = date_scheduler(this.review_time, hard_interval, true);
      next_good.scheduled_days = good_interval;
      next_good.due = date_scheduler(this.review_time, good_interval, true);
      next_easy.scheduled_days = easy_interval;
      next_easy.due = date_scheduler(this.review_time, easy_interval, true);
    }
    /**
     * Review next_state
     */
    next_state(next_hard, next_good, next_easy) {
      next_hard.state = State.Review;
      next_hard.learning_steps = 0;
      next_good.state = State.Review;
      next_good.learning_steps = 0;
      next_easy.state = State.Review;
      next_easy.learning_steps = 0;
    }
  };
  var LongTermScheduler = class extends AbstractScheduler {
    newState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      this.current.scheduled_days = 0;
      this.current.elapsed_days = 0;
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.init_ds(next_again, next_hard, next_good, next_easy);
      const first_interval = 0;
      this.next_interval(
        next_again,
        next_hard,
        next_good,
        next_easy,
        first_interval
      );
      this.next_state(next_again, next_hard, next_good, next_easy);
      this.update_next(next_again, next_hard, next_good, next_easy);
      return this.next.get(grade);
    }
    init_ds(next_again, next_hard, next_good, next_easy) {
      next_again.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Again),
        1,
        10
      );
      next_again.stability = this.algorithm.init_stability(Rating.Again);
      next_hard.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Hard),
        1,
        10
      );
      next_hard.stability = this.algorithm.init_stability(Rating.Hard);
      next_good.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Good),
        1,
        10
      );
      next_good.stability = this.algorithm.init_stability(Rating.Good);
      next_easy.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Easy),
        1,
        10
      );
      next_easy.stability = this.algorithm.init_stability(Rating.Easy);
    }
    /**
     * @see https://github.com/open-spaced-repetition/ts-fsrs/issues/98#issuecomment-2241923194
     */
    learningState(grade) {
      return this.reviewState(grade);
    }
    reviewState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const interval = this.elapsed_days;
      const { difficulty, stability } = this.last;
      const retrievability = this.algorithm.forgetting_curve(interval, stability);
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.next_ds(
        next_again,
        next_hard,
        next_good,
        next_easy,
        difficulty,
        stability,
        retrievability
      );
      this.next_interval(next_again, next_hard, next_good, next_easy, interval);
      this.next_state(next_again, next_hard, next_good, next_easy);
      next_again.lapses += 1;
      this.update_next(next_again, next_hard, next_good, next_easy);
      return this.next.get(grade);
    }
    /**
     * Review next_ds
     */
    next_ds(next_again, next_hard, next_good, next_easy, difficulty, stability, retrievability) {
      next_again.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Again
      );
      const s_after_fail = this.algorithm.next_forget_stability(
        difficulty,
        stability,
        retrievability
      );
      next_again.stability = clamp(stability, S_MIN, s_after_fail);
      next_hard.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Hard
      );
      next_hard.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Hard
      );
      next_good.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Good
      );
      next_good.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Good
      );
      next_easy.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Easy
      );
      next_easy.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Easy
      );
    }
    /**
     * Review/New next_interval
     */
    next_interval(next_again, next_hard, next_good, next_easy, interval) {
      let again_interval, hard_interval, good_interval, easy_interval;
      again_interval = this.algorithm.next_interval(
        next_again.stability,
        interval
      );
      hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
      good_interval = this.algorithm.next_interval(next_good.stability, interval);
      easy_interval = this.algorithm.next_interval(next_easy.stability, interval);
      again_interval = Math.min(again_interval, hard_interval);
      hard_interval = Math.max(hard_interval, again_interval + 1);
      good_interval = Math.max(good_interval, hard_interval + 1);
      easy_interval = Math.max(easy_interval, good_interval + 1);
      next_again.scheduled_days = again_interval;
      next_again.due = date_scheduler(this.review_time, again_interval, true);
      next_hard.scheduled_days = hard_interval;
      next_hard.due = date_scheduler(this.review_time, hard_interval, true);
      next_good.scheduled_days = good_interval;
      next_good.due = date_scheduler(this.review_time, good_interval, true);
      next_easy.scheduled_days = easy_interval;
      next_easy.due = date_scheduler(this.review_time, easy_interval, true);
    }
    /**
     * Review/New next_state
     */
    next_state(next_again, next_hard, next_good, next_easy) {
      next_again.state = State.Review;
      next_again.learning_steps = 0;
      next_hard.state = State.Review;
      next_hard.learning_steps = 0;
      next_good.state = State.Review;
      next_good.learning_steps = 0;
      next_easy.state = State.Review;
      next_easy.learning_steps = 0;
    }
    update_next(next_again, next_hard, next_good, next_easy) {
      const item_again = {
        card: next_again,
        log: this.buildLog(Rating.Again)
      };
      const item_hard = {
        card: next_hard,
        log: super.buildLog(Rating.Hard)
      };
      const item_good = {
        card: next_good,
        log: super.buildLog(Rating.Good)
      };
      const item_easy = {
        card: next_easy,
        log: super.buildLog(Rating.Easy)
      };
      this.next.set(Rating.Again, item_again);
      this.next.set(Rating.Hard, item_hard);
      this.next.set(Rating.Good, item_good);
      this.next.set(Rating.Easy, item_easy);
    }
  };
  var Reschedule = class {
    /**
     * Creates an instance of the `Reschedule` class.
     * @param fsrs - An instance of the FSRS class used for scheduling.
     */
    constructor(fsrs2) {
      __publicField(this, "fsrs");
      this.fsrs = fsrs2;
    }
    /**
     * Replays a review for a card and determines the next review date based on the given rating.
     * @param card - The card being reviewed.
     * @param reviewed - The date the card was reviewed.
     * @param rating - The grade given to the card during the review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     */
    replay(card, reviewed, rating) {
      return this.fsrs.next(card, reviewed, rating);
    }
    /**
     * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
     * @param card - The card being reviewed.
     * @param state - The state of the card after the review.
     * @param reviewed - The date the card was reviewed.
     * @param elapsed_days - The number of days since the last review.
     * @param stability - (Optional) The stability of the card.
     * @param difficulty - (Optional) The difficulty of the card.
     * @param due - (Optional) The due date for the next review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     * @throws Will throw an error if the state or due date is not provided when required.
     */
    handleManualRating(card, state, reviewed, elapsed_days, stability, difficulty, due) {
      if (typeof state === "undefined") {
        throw new Error("reschedule: state is required for manual rating");
      }
      let log;
      let next_card;
      if (state === State.New) {
        log = {
          rating: Rating.Manual,
          state,
          due: due ?? reviewed,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          learning_steps: card.learning_steps,
          review: reviewed
        };
        next_card = createEmptyCard(reviewed);
        next_card.last_review = reviewed;
      } else {
        if (typeof due === "undefined") {
          throw new Error("reschedule: due is required for manual rating");
        }
        const scheduled_days = date_diff(due, reviewed, "days");
        log = {
          rating: Rating.Manual,
          state: card.state,
          due: card.last_review || card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          learning_steps: card.learning_steps,
          review: reviewed
        };
        next_card = {
          ...card,
          state,
          due,
          last_review: reviewed,
          stability: stability || card.stability,
          difficulty: difficulty || card.difficulty,
          elapsed_days,
          scheduled_days,
          reps: card.reps + 1
        };
      }
      return { card: next_card, log };
    }
    /**
     * Reschedules a card based on its review history.
     *
     * @param current_card - The card to be rescheduled.
     * @param reviews - An array of review history objects.
     * @returns An array of record log items representing the rescheduling process.
     */
    reschedule(current_card, reviews) {
      const collections = [];
      let cur_card = createEmptyCard(current_card.due);
      for (const review of reviews) {
        let item;
        review.review = TypeConvert.time(review.review);
        if (review.rating === Rating.Manual) {
          let interval = 0;
          if (cur_card.state !== State.New && cur_card.last_review) {
            interval = date_diff(review.review, cur_card.last_review, "days");
          }
          item = this.handleManualRating(
            cur_card,
            review.state,
            review.review,
            interval,
            review.stability,
            review.difficulty,
            review.due ? TypeConvert.time(review.due) : void 0
          );
        } else {
          item = this.replay(cur_card, review.review, review.rating);
        }
        collections.push(item);
        cur_card = item.card;
      }
      return collections;
    }
    calculateManualRecord(current_card, now, record_log_item, update_memory) {
      if (!record_log_item) {
        return null;
      }
      const { card: reschedule_card, log } = record_log_item;
      const cur_card = TypeConvert.card(current_card);
      if (cur_card.due.getTime() === reschedule_card.due.getTime()) {
        return null;
      }
      cur_card.scheduled_days = date_diff(
        reschedule_card.due,
        cur_card.due,
        "days"
      );
      return this.handleManualRating(
        cur_card,
        reschedule_card.state,
        TypeConvert.time(now),
        log.elapsed_days,
        update_memory ? reschedule_card.stability : void 0,
        update_memory ? reschedule_card.difficulty : void 0,
        reschedule_card.due
      );
    }
  };
  var FSRS = class extends FSRSAlgorithm {
    constructor(param) {
      super(param);
      __publicField(this, "strategyHandler", /* @__PURE__ */ new Map());
      __publicField(this, "Scheduler");
      const { enable_short_term } = this.parameters;
      this.Scheduler = enable_short_term ? BasicScheduler : LongTermScheduler;
    }
    params_handler_proxy() {
      const _this = this;
      return {
        set: function(target, prop, value) {
          if (prop === "request_retention" && Number.isFinite(value)) {
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(value)
            );
          } else if (prop === "enable_short_term") {
            _this.Scheduler = value === true ? BasicScheduler : LongTermScheduler;
          } else if (prop === "w") {
            value = migrateParameters(
              value,
              target.relearning_steps.length,
              target.enable_short_term
            );
            _this.forgetting_curve = forgetting_curve.bind(this, value);
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(target.request_retention)
            );
          }
          Reflect.set(target, prop, value);
          return true;
        }
      };
    }
    useStrategy(mode, handler) {
      this.strategyHandler.set(mode, handler);
      return this;
    }
    clearStrategy(mode) {
      if (mode) {
        this.strategyHandler.delete(mode);
      } else {
        this.strategyHandler.clear();
      }
      return this;
    }
    getScheduler(card, now) {
      const schedulerStrategy = this.strategyHandler.get(
        StrategyMode.SCHEDULER
      );
      const Scheduler = schedulerStrategy || this.Scheduler;
      const instance = new Scheduler(card, now, this, this.strategyHandler);
      return instance;
    }
    /**
     * Display the collection of cards and logs for the four scenarios after scheduling the card at the current time.
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const card: Card = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date());
     * ```
     * @example
     * ```typescript
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
     * function repeatAfterHandler(recordLog: RecordLog) {
     *     const record: { [key in Grade]: RepeatRecordLog } = {} as {
     *       [key in Grade]: RepeatRecordLog;
     *     };
     *     for (const grade of Grades) {
     *       record[grade] = {
     *         card: {
     *           ...(recordLog[grade].card as Card & { cid: string }),
     *           due: recordLog[grade].card.due.getTime(),
     *           state: State[recordLog[grade].card.state] as StateType,
     *           last_review: recordLog[grade].card.last_review
     *             ? recordLog[grade].card.last_review!.getTime()
     *             : null,
     *         },
     *         log: {
     *           ...recordLog[grade].log,
     *           cid: (recordLog[grade].card as Card & { cid: string }).cid,
     *           due: recordLog[grade].log.due.getTime(),
     *           review: recordLog[grade].log.review.getTime(),
     *           state: State[recordLog[grade].log.state] as StateType,
     *           rating: Rating[recordLog[grade].log.rating] as RatingType,
     *         },
     *       };
     *     }
     *     return record;
     * }
     * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date(), repeatAfterHandler);
     * ```
     */
    repeat(card, now, afterHandler) {
      const instance = this.getScheduler(card, now);
      const recordLog = instance.preview();
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLog);
      } else {
        return recordLog;
      }
    }
    /**
     * Display the collection of cards and logs for the card scheduled at the current time, after applying a specific grade rating.
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param grade Rating of the review (Again, Hard, Good, Easy)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const card: Card = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLogItem = f.next(card, new Date(), Rating.Again);
     * ```
     * @example
     * ```typescript
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface NextRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
    function nextAfterHandler(recordLogItem: RecordLogItem) {
      const recordItem = {
        card: {
          ...(recordLogItem.card as Card & { cid: string }),
          due: recordLogItem.card.due.getTime(),
          state: State[recordLogItem.card.state] as StateType,
          last_review: recordLogItem.card.last_review
            ? recordLogItem.card.last_review!.getTime()
            : null,
        },
        log: {
          ...recordLogItem.log,
          cid: (recordLogItem.card as Card & { cid: string }).cid,
          due: recordLogItem.log.due.getTime(),
          review: recordLogItem.log.review.getTime(),
          state: State[recordLogItem.log.state] as StateType,
          rating: Rating[recordLogItem.log.rating] as RatingType,
        },
      };
      return recordItem
    }
     * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLogItem = f.repeat(card, new Date(), Rating.Again, nextAfterHandler);
     * ```
     */
    next(card, now, grade, afterHandler) {
      const instance = this.getScheduler(card, now);
      const g = TypeConvert.rating(grade);
      if (g === Rating.Manual) {
        throw new Error("Cannot review a manual rating");
      }
      const recordLogItem = instance.review(g);
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLogItem);
      } else {
        return recordLogItem;
      }
    }
    /**
     * Get the retrievability of the card
     * @param card  Card to be processed
     * @param now  Current time or scheduled time
     * @param format  default:true , Convert the result to another type. (Optional)
     * @returns  The retrievability of the card,if format is true, the result is a string, otherwise it is a number
     */
    get_retrievability(card, now, format = true) {
      const processedCard = TypeConvert.card(card);
      now = now ? TypeConvert.time(now) : /* @__PURE__ */ new Date();
      const t = processedCard.state !== State.New ? Math.max(date_diff(now, processedCard.last_review, "days"), 0) : 0;
      const r = processedCard.state !== State.New ? this.forgetting_curve(t, +processedCard.stability.toFixed(8)) : 0;
      return format ? `${(r * 100).toFixed(2)}%` : r;
    }
    /**
     *
     * @param card Card to be processed
     * @param log last review log
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now);
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now);
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log);
     * ```
     *
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler);  //see method: createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log, cardAfterHandler);
     * ```
     */
    rollback(card, log, afterHandler) {
      const processedCard = TypeConvert.card(card);
      const processedLog = TypeConvert.review_log(log);
      if (processedLog.rating === Rating.Manual) {
        throw new Error("Cannot rollback a manual rating");
      }
      let last_due;
      let last_review;
      let last_lapses;
      switch (processedLog.state) {
        case State.New:
          last_due = processedLog.due;
          last_review = void 0;
          last_lapses = 0;
          break;
        case State.Learning:
        case State.Relearning:
        case State.Review:
          last_due = processedLog.review;
          last_review = processedLog.due;
          last_lapses = processedCard.lapses - (processedLog.rating === Rating.Again && processedLog.state === State.Review ? 1 : 0);
          break;
      }
      const prevCard = {
        ...processedCard,
        due: last_due,
        stability: processedLog.stability,
        difficulty: processedLog.difficulty,
        elapsed_days: processedLog.last_elapsed_days,
        scheduled_days: processedLog.scheduled_days,
        reps: Math.max(0, processedCard.reps - 1),
        lapses: Math.max(0, last_lapses),
        learning_steps: processedLog.learning_steps,
        state: processedLog.state,
        last_review
      };
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(prevCard);
      } else {
        return prevCard;
      }
    }
    /**
     *
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param reset_count Should the review count information(reps,lapses) be reset. (Optional)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCard = createEmptyCard(now);
     * const scheduling_cards = f.repeat(emptyCard, now);
     * const { card, log } = scheduling_cards[Rating.Hard];
     * const forgetCard = f.forget(card, new Date(), true);
     * ```
     *
     * @example
     * ```typescript
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked; //see method: fsrs.repeat()
     * }
     *
     * function forgetAfterHandler(recordLogItem: RecordLogItem): RepeatRecordLog {
     *     return {
     *       card: {
     *         ...(recordLogItem.card as Card & { cid: string }),
     *         due: recordLogItem.card.due.getTime(),
     *         state: State[recordLogItem.card.state] as StateType,
     *         last_review: recordLogItem.card.last_review
     *           ? recordLogItem.card.last_review!.getTime()
     *           : null,
     *       },
     *       log: {
     *         ...recordLogItem.log,
     *         cid: (recordLogItem.card as Card & { cid: string }).cid,
     *         due: recordLogItem.log.due.getTime(),
     *         review: recordLogItem.log.review.getTime(),
     *         state: State[recordLogItem.log.state] as StateType,
     *         rating: Rating[recordLogItem.log.rating] as RatingType,
     *       },
     *     };
     * }
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler); //see method:  createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card } = repeatFormAfterHandler[Rating.Hard];
     * const forgetFromAfterHandler = f.forget(card, date_scheduler(now, 1, true), false, forgetAfterHandler);
     * ```
     */
    forget(card, now, reset_count = false, afterHandler) {
      const processedCard = TypeConvert.card(card);
      now = TypeConvert.time(now);
      const scheduled_days = processedCard.state === State.New ? 0 : date_diff(now, processedCard.due, "days");
      const forget_log = {
        rating: Rating.Manual,
        state: processedCard.state,
        due: processedCard.due,
        stability: processedCard.stability,
        difficulty: processedCard.difficulty,
        elapsed_days: 0,
        last_elapsed_days: processedCard.elapsed_days,
        scheduled_days,
        learning_steps: processedCard.learning_steps,
        review: now
      };
      const forget_card = {
        ...processedCard,
        due: now,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: reset_count ? 0 : processedCard.reps,
        lapses: reset_count ? 0 : processedCard.lapses,
        learning_steps: 0,
        state: State.New,
        last_review: processedCard.last_review
      };
      const recordLogItem = { card: forget_card, log: forget_log };
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLogItem);
      } else {
        return recordLogItem;
      }
    }
    /**
     * Reschedules the current card and returns the rescheduled collections and reschedule item.
     *
     * @template T - The type of the record log item.
     * @param {CardInput | Card} current_card - The current card to be rescheduled.
     * @param {Array<FSRSHistory>} reviews - The array of FSRSHistory objects representing the reviews.
     * @param {Partial<RescheduleOptions<T>>} options - The optional reschedule options.
     * @returns {IReschedule<T>} - The rescheduled collections and reschedule item.
     *
     * @example
     * ```typescript
     * const f = fsrs()
     * const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Good, Rating.Good]
     * const reviews_at = [
     *   new Date(2024, 8, 13),
     *   new Date(2024, 8, 13),
     *   new Date(2024, 8, 17),
     *   new Date(2024, 8, 28),
     * ]
     *
     * const reviews: FSRSHistory[] = []
     * for (let i = 0; i < grades.length; i++) {
     *   reviews.push({
     *     rating: grades[i],
     *     review: reviews_at[i],
     *   })
     * }
     *
     * const results_short = scheduler.reschedule(
     *   createEmptyCard(),
     *   reviews,
     *   {
     *     skipManual: false,
     *   }
     * )
     * console.log(results_short)
     * ```
     */
    reschedule(current_card, reviews = [], options = {}) {
      const {
        recordLogHandler,
        reviewsOrderBy,
        skipManual = true,
        now = /* @__PURE__ */ new Date(),
        update_memory_state: updateMemoryState = false
      } = options;
      if (reviewsOrderBy && typeof reviewsOrderBy === "function") {
        reviews.sort(reviewsOrderBy);
      }
      if (skipManual) {
        reviews = reviews.filter((review) => review.rating !== Rating.Manual);
      }
      const rescheduleSvc = new Reschedule(this);
      const collections = rescheduleSvc.reschedule(
        options.first_card || createEmptyCard(),
        reviews
      );
      const len = collections.length;
      const cur_card = TypeConvert.card(current_card);
      const manual_item = rescheduleSvc.calculateManualRecord(
        cur_card,
        now,
        len ? collections[len - 1] : void 0,
        updateMemoryState
      );
      if (recordLogHandler && typeof recordLogHandler === "function") {
        return {
          collections: collections.map(recordLogHandler),
          reschedule_item: manual_item ? recordLogHandler(manual_item) : null
        };
      }
      return {
        collections,
        reschedule_item: manual_item
      };
    }
  };
  var fsrs = (params) => {
    return new FSRS(params || {});
  };

  // obsidian/srs/core.js
  var SCHEDULER_VERSION = "ts-fsrs@5.2.3/FSRS-6";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var DEVICE = /^(?:anki|computer|android|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  var SCHEDULER_CONFIG_ID = /^[0-9a-f]{64}$/;
  function validateOptions(options, requireDailyLimit = true) {
    if (!options || options.algorithm !== "FSRS-6" || options.enable_fuzz !== false || !Number.isFinite(options.desired_retention) || options.desired_retention <= 0 || options.desired_retention >= 1 || !Number.isInteger(options.maximum_interval) || options.maximum_interval < 1 || options.maximum_interval > 36500 ||
        (requireDailyLimit || options.new_cards_per_day !== undefined) && (!Number.isInteger(options.new_cards_per_day) || options.new_cards_per_day < 0)) throw Error("Unsupported scheduler configuration");
  }
  function scheduler(options) {
    validateOptions(options);
    return fsrs({ request_retention: options.desired_retention, maximum_interval: options.maximum_interval, enable_fuzz: false });
  }
  function serialize(state) {
    const result = { ...state, due: state.due.getTime() };
    if (state.last_review) result.last_review = state.last_review.getTime();
    return result;
  }
  function hydrate(state) {
    const result = { ...state, due: new Date(state.due) };
    if (state.last_review !== void 0) result.last_review = new Date(state.last_review);
    return result;
  }
  function initialState(card, engine, now = Date.now()) {
    let state = createEmptyCard(new Date(now));
    if (card.queue === 0) return serialize(state);
    let count = 0;
    for (const event of [...card.history].sort((a, b) => a.review_time_ms - b.review_time_ms || a.id.localeCompare(b.id))) {
      if (![0, 1, 2, 3].includes(event.review_type) || ![1, 2, 3, 4].includes(event.rating)) continue;
      state = engine.next(state, new Date(event.review_time_ms), event.rating).card;
      count++;
    }
    if (!count || !Number.isFinite(card.due_ms)) throw Error(`Cannot initialize card ${card.id}: missing review history or due date`);
    state.due = new Date(card.due_ms);
    state.state = card.card_type === 3 ? State.Relearning : card.queue === 2 ? State.Review : State.Learning;
    return serialize(state);
  }
  function validateState(state) {
    if (!state || ![0, 1, 2, 3].includes(state.state)) throw Error("Invalid scheduler state");
    for (const key of ["due", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "learning_steps"]) {
      if (!Number.isFinite(state[key]) || key !== "due" && state[key] < 0) throw Error(`Invalid state field ${key}`);
    }
    if (state.last_review !== void 0 && !Number.isFinite(state.last_review)) throw Error("Invalid last_review");
  }
  function validateEvent(event, importId) {
    if (event?.format_version === 2 && event.kind === "card_settings") {
      if (!UUID.test(event.id) || !DEVICE.test(event.device_id) || typeof event.card_id !== "string" || !event.card_id ||
          !Number.isSafeInteger(event.time_ms) || event.time_ms < 0 || !event.changes || typeof event.changes !== "object" || Array.isArray(event.changes) ||
          !Object.keys(event.changes).length) throw Error("Invalid card settings event");
      for (const [key,value] of Object.entries(event.changes)) {
        if (!["suspended","tags","profile"].includes(key)) throw Error(`Unknown card setting: ${key}`);
        if (value === null) continue;
        if (key === "profile" && (typeof value!=="string"||!value.trim()))throw Error("Invalid profile setting");
        if (key === "suspended" && typeof value !== "boolean" || key === "tags" &&
            (!Array.isArray(value) || value.some(tag=>typeof tag!=="string" || !tag.trim()) || new Set(value).size!==value.length)) throw Error(`Invalid card setting: ${key}`);
      }
      return event;
    }
    if (event?.format_version === 2 && ["historical_review", "scheduling_baseline"].includes(event.kind)) {
      if (typeof event.id !== "string" || !Number.isSafeInteger(event.review_time_ms) || !DEVICE.test(event.device_id)) throw Error("Invalid imported event");
      if (event.kind === "historical_review") {
        if (event.id !== `anki:${event.collection_key}:${event.anki_revlog_id}` || event.state !== undefined || !event.original_review) throw Error("Invalid historical observation");
      } else {
        if (typeof event.import_id !== "string" || event.id !== `baseline:${event.import_id}:${event.card_id}`) throw Error("Invalid scheduling baseline");
        if (event.state !== null) validateState(event.state);
      }
      return event;
    }
    if (event?.format_version === 2 && event.kind !== "answer") throw Error("Unknown event kind");
    if (!event || ![1, 2].includes(event.format_version) || !UUID.test(event.id) || !DEVICE.test(event.device_id) || (typeof event.card_id !== "string" || !event.card_id) || event.import_id !== importId || ![1, 2, 3, 4].includes(event.rating) || !Number.isSafeInteger(event.review_time_ms) || event.review_time_ms < 0 || !Number.isFinite(event.duration_ms) || event.duration_ms < 0 || typeof event.was_new !== "boolean" || typeof event.parent !== "string") throw Error("Invalid or incompatible review event");
    validateState(event.state);
    if (!UUID.test(event.parent) && event.parent !== `import:${importId}:${event.card_id}`) throw Error("Invalid parent state reference");
    if (Object.hasOwn(event,"scheduler_config_id")) {
      if(event.format_version!==2 || typeof event.scheduler_config_id!=="string" || !SCHEDULER_CONFIG_ID.test(event.scheduler_config_id) || Object.hasOwn(event,"scheduler_config") || Object.hasOwn(event,"scheduler_version"))throw Error("Invalid scheduler configuration reference");
    } else {
      if(event.scheduler_version!==SCHEDULER_VERSION)throw Error("Unsupported scheduler version");
      validateOptions(event.scheduler_config);
    }
    if (event.state.last_review !== event.review_time_ms) throw Error("Review timestamp and state disagree");
    return event;
  }
  function makeEvent({ card, current, rating, now, duration, deviceId, eventId, manifest, engine }) {
    if (![1, 2, 3, 4].includes(rating)) throw Error("Invalid rating");
    if (current.state.last_review !== void 0 && now < current.state.last_review) throw Error("Device clock precedes the last review");
    const state = engine.next(hydrate(current.state), new Date(now), rating).card;
    const event = {
      format_version: 1,
      id: eventId,
      device_id: deviceId,
      card_id: card.id,
      import_id: manifest.import_id,
      parent: current.parent,
      review_time_ms: now,
      duration_ms: Math.max(0, duration),
      rating,
      was_new: current.state.state === State.New,
      scheduler_version: SCHEDULER_VERSION,
      scheduler_config: manifest.scheduler,
      state: serialize(state)
    };
    return validateEvent(event, manifest.import_id);
  }
  function renderTemplate(template, fields) {
    const token = /{{([#/^]?)([A-Za-z_][A-Za-z_0-9]*)}}/g;
    const stack = [{ visible: true, name: null }];
    let output = "", offset = 0;
    for (const match of template.matchAll(token)) {
      if (stack.at(-1).visible) output += template.slice(offset, match.index);
      const [, marker, key] = match;
      if (!Object.hasOwn(fields, key)) throw Error(`Unknown template field ${key}`);
      if (marker === "#" || marker === "^") {
        const present = String(fields[key] ?? "").trim() !== "";
        stack.push({ name: key, visible: stack.at(-1).visible && (marker === "#" ? present : !present) });
      } else if (marker === "/") {
        if (stack.length === 1 || stack.pop().name !== key) throw Error("Unbalanced template");
      } else if (stack.at(-1).visible) output += fields[key] ?? "";
      offset = match.index + match[0].length;
    }
    if (stack.length !== 1 || /{{|}}/.test(template.replace(token, ""))) throw Error("Unsupported template syntax");
    output += template.slice(offset);
    return output;
  }
  function parseCSV(input2) {
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    input2 = input2.replace(/^\uFEFF/, "");
    const pushField = () => {
      row.push(field);
      field = "";
      closed = false;
    };
    const pushRow = () => {
      pushField();
      rows.push(row);
      row = [];
    };
    for (let i = 0; i < input2.length; i++) {
      const ch = input2[i];
      if (quoted) {
        if (ch === '"' && input2[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
          closed = true;
        } else field += ch;
      } else if (ch === ",") pushField();
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && input2[i + 1] === "\n") i++;
        pushRow();
      } else if (ch === '"' && field === "" && !closed) quoted = true;
      else {
        if (closed || ch === '"') throw Error("Malformed CSV quoting");
        field += ch;
      }
    }
    if (quoted) throw Error("Unterminated CSV quote");
    if (field || row.length || closed) pushRow();
    const columns = rows.shift();
    if (!columns || new Set(columns).size !== columns.length) throw Error("Invalid CSV header");
    return rows.filter((row2) => !(row2.length === 1 && row2[0] === "")).map((row2) => {
      if (row2.length !== columns.length) throw Error("CSV row width differs from header");
      return Object.fromEntries(columns.map((column, index) => [column, row2[index]]));
    });
  }
  function sourceFields(card, rows) {
    const matches = rows instanceof Map ? rows.has(card.note_uid) ? [rows.get(card.note_uid)] : [] : rows.filter((row) => {
      const nid = (row.anki_note_id || "").trim();
      return card.note_uid === (nid ? `anki:${BigInt(nid)}` : `local:${(row.srs_note_id || row.srs_uid || "").trim().toLowerCase()}`);
    });
    if (!matches.length) return null;
    if (matches.length !== 1) throw Error(`Duplicate source identity ${card.note_uid}`);
    return Object.fromEntries(Object.entries(card.source.field_map).map(([target, source]) => [target, matches[0][source] ?? ""]));
  }
  function indexRows(rows) {
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const nid = (row.anki_note_id || "").trim();
      const uid = nid ? `anki:${BigInt(nid)}` : `local:${(row.srs_note_id || row.srs_uid || "").trim().toLowerCase()}`;
      if (uid === "local:") continue;
      if (result.has(uid)) throw Error(`Duplicate source identity ${uid}`);
      result.set(uid, row);
    }
    return result;
  }
  function configuredCards(cards, config) {
    if (config.format_version !== 1 || !config.groups || typeof config.groups !== "object") throw Error("Unsupported card configuration");
    const templates = /* @__PURE__ */ new Map();
    for (const [group, definition] of Object.entries(config.groups)) {
      if (!Array.isArray(definition.templates)) throw Error(`Invalid templates for ${group}`);
      for (const template of definition.templates) {
        const id = `${group}/${template.key}`;
        if (!/^[a-z][a-z0-9_-]*$/.test(template.key) || templates.has(id) || typeof template.enabled !== "boolean" || !Array.isArray(template.required_fields) || typeof template.front !== "string" || typeof template.back !== "string") throw Error(`Invalid template: ${id}`);
        templates.set(id, template);
      }
    }
    return cards.map((card) => {
      if (card.retired) return {...card, active:false};
      const template = templates.get(`${card.group}/${card.template_key}`);
      if (template && (template.anki_notetype !== card.anki_notetype || template.anki_ordinal !== card.anki_ordinal && !(card.cloze===true && template.front.includes("{{cloze:")))) throw Error(`Card binding changed for ${card.group}/${card.template_key}; re-run migration`);
      return { ...card, template, active: true };
    });
  }
  function studyDay(timestamp, timing) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timing.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const day = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
    if (+parts.hour < timing.rollover_hour) day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  }
  function reviewQueue(cards, states, events, manifest, now, group, introducedCount) {
    const count = introducedCount ?? new Set(events.filter((e) => e.was_new && studyDay(e.review_time_ms, manifest.timing) === studyDay(now, manifest.timing)).map((e) => e.card_id)).size;
    const remaining = Math.max(0, manifest.scheduler.new_cards_per_day - count);
    const eligible = cards.filter((c) => c.active && (!group || c.group === group) && states.has(c.id));
    const due = eligible.filter((c) => states.get(c.id).state.state !== State.New && states.get(c.id).state.due <= now).sort((a, b) => states.get(a.id).state.due - states.get(b.id).state.due || a.id.localeCompare(b.id));
    const fresh = eligible.filter((c) => states.get(c.id).state.state === State.New).sort((a, b) => a.id.localeCompare(b.id)).slice(0, remaining);
    return { cards: [...due, ...fresh], due: due.length, fresh: fresh.length };
  }

  // obsidian/srs/logs.js
  var LOG_LIMIT = 32 * 1024 * 1024;
  var LOG_PATTERN = /^(?:anki|computer|android|[0-9a-f-]{36})-\d{4}-\d{2}(?:-\d{3,})?(?:\.sync-conflict-[^.]+)?\.jsonl$/;
  var encoder = new TextEncoder();
  var bytes = (text) => encoder.encode(text).byteLength;
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function hash(text) {
    const data = await crypto.subtle.digest("SHA-256", encoder.encode(text));
    return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function validateSchedulerConfig(document) {
    if(!document || document.scheduler_version!==SCHEDULER_VERSION)throw Error("Unsupported scheduler version");
    validateOptions(document.settings,false);
    const weights=document.settings.weights;
    if(weights!==undefined && (!Array.isArray(weights) || ![17,19,21].includes(weights.length) || weights.some(value=>!Number.isFinite(value)) || !document.settings.parameter_policy))throw Error("Unsupported trained scheduler parameters");
  }
  async function verifySchedulerConfig(id,text) {
    if(typeof id!=="string" || !SCHEDULER_CONFIG_ID.test(id))throw Error("Invalid scheduler configuration reference");
    if(text===null || text===undefined)throw Error(`Missing scheduler configuration: ${id}`);
    let document;
    try{document=JSON.parse(text);}catch{throw Error(`Malformed scheduler configuration: ${id}`);}
    if(await hash(canonical(document))!==id)throw Error(`Scheduler configuration hash mismatch: ${id}`);
    validateSchedulerConfig(document);
    return document;
  }
  async function saveSchedulerConfig(store,directory,settings,schedulerVersion=SCHEDULER_VERSION) {
    // Daily allowances and preset labels do not affect an answer's calculation.
    const {new_cards_per_day,preset_id,...parameters}=settings;
    const document=JSON.parse(JSON.stringify({scheduler_version:schedulerVersion,settings:parameters}));
    validateSchedulerConfig(document);
    const text=canonical(document), id=await hash(text), path=`${directory}/${id}.json`;
    if(await store.read(path)===null) {
      if(store.mkdir)await store.mkdir(directory);
      try{await store.create(path,text+"\n");}
      catch(error){if(await store.read(path)===null)throw error;}
    }
    // Never overwrite an existing file, including a corrupt or conflicting copy.
    await verifySchedulerConfig(id,await store.read(path));
    return id;
  }
  function compare(a, b) {
    return a.review_time_ms - b.review_time_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  async function withStoreLock(key, operation) {
    if (globalThis.navigator?.locks) return navigator.locks.request(key, operation);
    const locks = globalThis.__ankobsSRSLocks || (globalThis.__ankobsSRSLocks = /* @__PURE__ */ new Map());
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {
    }).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }
  async function appendReview(store, directory, event, limit = LOG_LIMIT) {
    const line = JSON.stringify(event) + "\n";
    if (bytes(line) > limit) throw Error("Review record exceeds log size limit");
    const month = new Date(event.kind === "card_settings" ? event.time_ms : event.review_time_ms).toISOString().slice(0, 7);
    let part = 1;
    if (store.list) {
      const stem = `${event.device_id}-${month}`;
      for (const file of await store.list(directory)) {
        const name = file.path.split("/").at(-1);
        if (name === `${stem}.jsonl`) continue;
        const match = name.startsWith(`${stem}-`) && /^-(\d{3,})\.jsonl$/.exec(name.slice(stem.length));
        if (match) part = Math.max(part, Number(match[1]));
      }
    }
    while (true) {
      const suffix = part === 1 ? "" : `-${String(part).padStart(3, "0")}`;
      const path = `${directory}/${event.device_id}-${month}${suffix}.jsonl`;
      const before = await store.read(path);
      if (before !== null && before && !before.endsWith("\n")) throw Error(`Incomplete review log: ${path}`);
      if (before !== null && before.includes(`"id":"${event.id}"`)) {
        const same = before.split("\n").filter(Boolean).map(JSON.parse).find((item) => item.id === event.id);
        if (!same || canonical(same) !== canonical(event)) throw Error("Review event ID collision");
        return path;
      }
      if (bytes(before || "") + bytes(line) > limit) {
        part++;
        continue;
      }
      const expected = (before || "") + line;
      try {
        if (before === null) await store.create(path, line);
        else await store.append(path, line);
      } catch (error) {
        if (await store.read(path) !== expected) throw error;
      }
      if (await store.read(path) !== expected) throw Error(`Review log verification failed: ${path}`);
      return path;
    }
  }
  function request(operation) {
    return new Promise((resolve, reject) => {
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () => reject(operation.error);
    });
  }
  async function transaction(database, stores, mode, operation) {
    const tx = database.transaction(stores, mode);
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error("Index transaction aborted"));
      tx.onerror = () => {
      };
    });
    try {
      const result = await operation(tx);
      await completed;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
      }
      await completed.catch(() => {
      });
      throw error;
    }
  }
  var ReviewIndex = class _ReviewIndex {
    constructor(database, importId, timing) {
      this.database = database;
      this.importId = importId;
      this.timing = timing;
    }
    static async open(name, importId, timing, factory = globalThis.indexedDB) {
      if (!factory) throw Error("IndexedDB is unavailable; a persistent local review index is required");
      const opening = factory.open(name, 3);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        for (const name2 of ["meta", "files", "seen", "latest", "baselines", "card_settings"]) if (!db.objectStoreNames.contains(name2)) db.createObjectStore(name2);
        if (!db.objectStoreNames.contains("observations")) {
          const observations = db.createObjectStore("observations", {keyPath: "id"});
          observations.createIndex("card_id", "card_id");
        }
        if (!db.objectStoreNames.contains("activity")) {
          const activity = db.createObjectStore("activity", {keyPath: "id"}); activity.createIndex("day", "day");
        }
        if (!db.objectStoreNames.contains("introduced")) {
        const introduced = db.createObjectStore("introduced", { keyPath: ["day", "card_id"] });
        introduced.createIndex("day", "day");
        }
      };
      const database = await request(opening);
      database.onversionchange = () => database.close();
      const result = new _ReviewIndex(database, importId, timing);
      const stored = await result.get("meta", "import");
      if (stored !== importId || await result.get("meta", "schema") !== 2) {
        await result.clear();
        await result.put("meta", "import", importId);
        await result.put("meta", "schema", 2);
      }
      return result;
    }
    close() {
      this.database.close();
    }
    get(store, key) {
      return transaction(this.database, [store], "readonly", (tx) => request(tx.objectStore(store).get(key)));
    }
    put(store, key, value) {
      return transaction(this.database, [store], "readwrite", (tx) => request(tx.objectStore(store).put(value, key)));
    }
    async clear() {
      await transaction(this.database, ["files", "seen", "latest", "introduced", "baselines", "observations", "activity", "card_settings"], "readwrite", async (tx) => {
        await Promise.all(["files", "seen", "latest", "introduced", "baselines", "observations", "activity", "card_settings"].map((name) => request(tx.objectStore(name).clear())));
      });
    }
    async latest() {
      const events = await transaction(this.database, ["latest"], "readonly", (tx) => request(tx.objectStore("latest").getAll()));
      return new Map(events.map((event) => [event.card_id, event]));
    }
    async cardSettings() {
      const rows=await transaction(this.database,["card_settings"],"readonly",tx=>request(tx.objectStore("card_settings").getAll()));
      return new Map(rows.map(row=>[row.card_id,Object.fromEntries(Object.entries(row.fields).filter(([,field])=>field.value!==null).map(([key,field])=>[key,field.value]))]));
    }
    async cardSettingsFor(cardId) {
      const row=await this.get("card_settings",cardId);
      return Object.fromEntries(Object.entries(row?.fields||{}).filter(([,field])=>field.value!==null).map(([key,field])=>[key,field.value]));
    }
    async introducedToday(now) {
      const day = studyDay(now, this.timing);
      return transaction(this.database, ["introduced"], "readonly", (tx) => request(tx.objectStore("introduced").index("day").count(day)));
    }
    async historyFor(cardId) {
      return transaction(this.database,["observations"],"readonly",tx=>request(tx.objectStore("observations").index("card_id").getAll(cardId)));
    }
    async activityToday(now) {
      const day=studyDay(now,this.timing);
      return transaction(this.database,["activity"],"readonly",tx=>request(tx.objectStore("activity").index("day").getAll(day)));
    }
    async ingest(events, knownCards, {readSchedulerConfig, configs = new Map()} = {}) {
      const records = await Promise.all(events.map(async (event) => {
        validateEvent(event, this.importId);
        if(event.scheduler_config_id) {
          const id=event.scheduler_config_id;
          if(!readSchedulerConfig)throw Error(`Missing scheduler configuration reader: ${id}`);
          if(!configs.has(id))configs.set(id,(async()=>verifySchedulerConfig(id,await readSchedulerConfig(id)))());
          await configs.get(id);
        }
        if (event.kind !== "historical_review" && !knownCards.has(event.card_id)) throw Error(`Unknown review card: ${event.card_id}`);
        return { event, hash: await hash(canonical(event)), day: event.kind !== "card_settings" && event.was_new ? studyDay(event.review_time_ms, this.timing) : null };
      }));
      await transaction(this.database, ["seen", "latest", "introduced", "observations", "activity", "card_settings"], "readwrite", async (tx) => {
        const seen = tx.objectStore("seen"), latest = tx.objectStore("latest");
        for (const record of records) {
          const previous = await request(seen.get(record.event.id));
          if (previous && previous !== record.hash) throw Error(`Conflicting contents for event ${record.event.id}`);
          if (previous) continue;
          await request(seen.put(record.hash, record.event.id));
          if (record.event.kind === "card_settings") {
            const event=record.event, settings=tx.objectStore("card_settings");
            const row=await request(settings.get(event.card_id)) || {card_id:event.card_id,fields:{}};
            for(const [key,value] of Object.entries(event.changes)) {
              const old=row.fields[key];
              if(!old || event.time_ms>old.time_ms || event.time_ms===old.time_ms && event.id>old.id)
                row.fields[key]={value,time_ms:event.time_ms,id:event.id};
            }
            await request(settings.put(row,event.card_id));
            continue;
          }
          if (record.event.kind === "historical_review") {
            if (record.event.card_id) await request(tx.objectStore("observations").put(record.event));
            continue;
          }
          if (record.event.kind === "scheduling_baseline") continue;
          await request(tx.objectStore("activity").put({...record.event,day:studyDay(record.event.review_time_ms,this.timing)}));
          const state = await request(latest.get(record.event.card_id));
          if (!state || compare(record.event, state) > 0) await request(latest.put(record.event, record.event.card_id));
          if (record.day) await request(tx.objectStore("introduced").put({ day: record.day, card_id: record.event.card_id }));
        }
      });
    }
    /** Fingerprint unchanged files; parse only appended lines when prefix matches.
     * A replaced/deleted log triggers a full rebuild so no stale states survive.
     * Checkpoints commit only after every event in that file has been indexed.
     */
    async sync(files, read, knownCards, { progress = () => {
    }, force = /* @__PURE__ */ new Set(), readSchedulerConfig, onEvents } = {}) {
      const configs=new Map();
      const cached = await transaction(this.database, ["files"], "readonly", async (tx) => {
        const store = tx.objectStore("files");
        const keys = await request(store.getAllKeys());
        const values = await request(store.getAll());
        return new Map(keys.map((key, i) => [key, values[i]]));
      });
      const present = new Set(files.map((file) => file.path));
      let reset = [...cached.keys()].some((path) => !present.has(path));
      let parsed = 0, readFiles = 0;
      if (reset) {
        await this.clear();
        cached.clear();
      }
      for (const file of files) {
        const old = cached.get(file.path);
        if (old && file.stat && old.mtime === file.stat.mtime && old.size === file.stat.size && !force.has(file.path)) continue;
        const text = await read(file);
        readFiles++;
        if (text && !text.endsWith("\n")) throw Error(`Incomplete final review record in ${file.path}`);
        let start = 0;
        if (old) {
          if (text.length >= old.length && await hash(text.slice(0, old.length)) === old.hash) start = old.length;
          else {
            await this.clear();
            const result = await this.sync(files, read, knownCards, { progress, readSchedulerConfig, onEvents });
            return { ...result, rebuilt: true };
          }
        }
        let batch = [];
        while (start < text.length) {
          const end = text.indexOf("\n", start);
          const line = text.slice(start, end);
          start = end + 1;
          if (!line.trim()) continue;
          try {
            batch.push(JSON.parse(line));
          } catch {
            throw Error(`Malformed review record in ${file.path}`);
          }
          parsed++;
          if (batch.length === 500) {
            await this.ingest(batch, knownCards, {readSchedulerConfig,configs});
            onEvents?.(batch);
            batch = [];
            progress(parsed, file.path);
          }
        }
        if (batch.length){await this.ingest(batch, knownCards, {readSchedulerConfig,configs});onEvents?.(batch);}
        await this.put("files", file.path, { mtime: file.stat?.mtime, size: file.stat?.size, length: text.length, hash: await hash(text) });
        progress(parsed, file.path);
      }
      return { parsed, readFiles, rebuilt: reset };
    }
  };


const US_STATES = {"alabama": "Alabama", "alaska": "Alaska", "arizona": "Arizona", "arkansas": "Arkansas", "california": "California", "colorado": "Colorado", "connecticut": "Connecticut", "delaware": "Delaware", "florida": "Florida", "georgia": "Georgia", "hawaii": "Hawaii", "idaho": "Idaho", "illinois": "Illinois", "indiana": "Indiana", "iowa": "Iowa", "kansas": "Kansas", "kentucky": "Kentucky", "louisiana": "Louisiana", "maine": "Maine", "maryland": "Maryland", "massachusetts": "Massachusetts", "michigan": "Michigan", "minnesota": "Minnesota", "mississippi": "Mississippi", "missouri": "Missouri", "montana": "Montana", "nebraska": "Nebraska", "nevada": "Nevada", "new-hampshire": "New Hampshire", "new-jersey": "New Jersey", "new-mexico": "New Mexico", "new-york": "New York", "north-carolina": "North Carolina", "north-dakota": "North Dakota", "ohio": "Ohio", "oklahoma": "Oklahoma", "oregon": "Oregon", "pennsylvania": "Pennsylvania", "rhode-island": "Rhode Island", "south-carolina": "South Carolina", "south-dakota": "South Dakota", "tennessee": "Tennessee", "texas": "Texas", "utah": "Utah", "vermont": "Vermont", "virginia": "Virginia", "washington": "Washington", "west-virginia": "West Virginia", "wisconsin": "Wisconsin", "wyoming": "Wyoming"};
// Browser implementation bundled into ../view.js by build.py. No runtime tooling.
function effectiveSettings(card, manifest) {
  if(manifest.study){
    const id=studyProfileId(card,manifest.study,manifest),profile=manifest.study.profiles[id];
    const deck=manifest.scheduling.decks[card.original_deck_id||card.deck_id];
    const retention=profile.imported_preset===deck?.normal?.config_id ? deck.normal.desired_retention : undefined;
    return {...profile.settings,preset_id:id,desired_retention:retention??profile.settings.desired_retention};
  }
  if (!manifest.scheduling) return manifest.scheduler;
  const meta = manifest.scheduling;
  const deck = meta.decks[card.original_deck_id || card.deck_id];
  const preset = meta.presets[deck.normal.config_id || "1"];
  const s = preset.settings;
  const field = ["fsrs_params_6", "fsrs_params_5", "fsrs_params_4"].find(k => s[k]?.length);
  return {
    algorithm: "FSRS-6", weights: s[field] || [], parameter_field: field,
    parameter_policy: meta.parameter_policy, source_anki_version: meta.source_anki_version,
    preset_id: preset.id, desired_retention: deck.normal.desired_retention ?? s.desired_retention,
    maximum_interval: s.maximum_review_interval, minimum_interval: s.minimum_lapse_interval,
    learning_steps: s.learn_steps, relearning_steps: s.relearn_steps,
    new_cards_per_day: s.new_per_day, enable_fuzz: false,
    short_term_with_steps: Boolean(meta.collection.fsrsShortTermWithStepsEnabled)
  };
}
function schedulerV2(options) {
  validateOptions(options);
  if (options.weights) {
    if (!options.parameter_policy) throw Error("Source Anki version is unconfirmed. Run desktop verification before rating.");
    if (![17, 19, 21].includes(options.weights.length) || options.weights.some(x => !Number.isFinite(x)))
      throw Error("Unsupported trained scheduler parameters");
  }
  const engine = fsrs({request_retention: options.desired_retention, maximum_interval: options.maximum_interval,
    enable_fuzz: false, w: options.weights,
    ...(options.learning_steps ? {learning_steps: options.learning_steps.map(x => `${x}m`)} : {}),
    ...(options.relearning_steps ? {relearning_steps: options.relearning_steps.map(x => `${x}m`)} : {})});
  // Anki permits initial stability below the bundled library's 0.1 floor.
  engine.init_stability = rating => engine.param.w[rating - 1];
  // The native short-term model prevents Hard from reducing stability too.
  engine.next_short_term_stability = (s, rating) => {
    const w = engine.param.w;
    const growth = Math.pow(s, -w[19]) * Math.exp(w[17] * (rating - 3 + w[18]));
    return Math.min(36500, Math.max(.001, s * (rating >= 2 ? Math.max(1, growth) : growth)));
  };
  return engine;
}
function renderV2(template, fields, ordinal = 0, answer = false) {
  if (/<script\b|\bon\w+\s*=|javascript:/i.test(template)) throw Error("Unsupported template operation: JavaScript");
  const token = /{{([#/^]?)([^{}]+)}}/g;
  const stack = [{visible: true, name: null}];
  let output = "", offset = 0;
  const value = expression => {
    const parts = expression.split(":"), key = parts.pop();
    if (!Object.hasOwn(fields, key)) throw Error(`Missing template field: ${key}`);
    let v = String(fields[key] ?? "");
    for (const filter of parts.reverse()) {
      if (filter === "cloze") v = v.replace(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/g,
        (_, n, body, hint) => +n === ordinal + 1 ? answer ? body : `[${hint || "…"}]` : body);
      else if (filter === "text") v = v.replace(/<[^>]*>/g, "");
      else if (filter === "type") throw Error("Unsupported template operation: type-answer input");
      else throw Error(`Unsupported template filter: ${filter}`);
    }
    return v;
  };
  for (const match of template.matchAll(token)) {
    if (stack.at(-1).visible) output += template.slice(offset, match.index);
    const [, marker, key] = match;
    if (marker === "#" || marker === "^") {
      const present = value(key).trim() !== "";
      stack.push({name: key, visible: stack.at(-1).visible && (marker === "#" ? present : !present)});
    } else if (marker === "/") {
      if (stack.length === 1 || stack.pop().name !== key) throw Error(`Unbalanced template section: ${key}`);
    } else if (stack.at(-1).visible) output += value(key);
    offset = match.index + match[0].length;
  }
  if (stack.length !== 1 || /{{|}}/.test(template.replace(token, ""))) throw Error("Unsupported template syntax");
  return output + template.slice(offset);
}
// Markdown renderers do not expand wikilink embeds inside HTML template blocks.
function resolveImageEmbeds(content, sourcePath, resolveFile, resourcePath) {
  const escape = value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return content.replace(/!\[\[([^\]\n]+)\]\]/g, (embed, reference) => {
    const [target, size] = reference.split("|");
    const path = target.split("#")[0];
    if (!/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)) return embed;
    const file = resolveFile(path, sourcePath);
    if (!file) throw Error(`Missing vault image: ${path}`);
    const dimensions = size?.match(/^(\d+)(?:x(\d+))?$/);
    return `<img src="${escape(resourcePath(file))}" alt="${escape(path.split("/").at(-1))}"${dimensions ? ` width="${dimensions[1]}"${dimensions[2] ? ` height="${dimensions[2]}"` : ""}` : ""}>`;
  });
}
function transformField(name, value, note) {
  const text = v => v == null ? "" : String(v).trim();
  const list = v => Array.isArray(v) ? v : [v];
  const label = v => text(v).replace(/^!?\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]$/, (_, p, l) => l || p.split("/").at(-1).replace(/\.md$/, ""));
  const media = v => list(v).filter(x => text(x)).map(x => {
    const m = text(x).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if (!m) throw Error(`Expected vault media reference: ${text(x)}`);
    return `![[${m[1]}]]`;
  }).join("\n");
  switch (name) {
    case "text": case "markdown_body": return text(value);
    case "capitalize": return text(value).replace(/^./, x => x.toUpperCase());
    case "functional_group_name": return text(value).replace(/-group$/i, "").replace(/^./, x => x.toUpperCase());
    case "ph_front": return text(note.metadata.name_zh) || text(note.metadata.name_en) || note.filename;
    case "ph_units": return "pH";
    case "first_alias": if (!Array.isArray(value) || !text(value[0])) throw Error("Missing first alias"); return text(value[0]);
    case "chinese_alias": {const v = list(value).find(x => /\p{Script=Han}/u.test(text(x))); if (!v) throw Error("Missing Chinese alias"); return text(v);}
    case "wikilink_label": return label(value);
    case "comma_separated_labels": return list(value).map(label).filter(Boolean).join(", ");
    case "image": case "image_list": case "optional_image": case "sound": return media(value);
    case "country_flags": return [note.metadata.flag_blur, value].filter(x => text(x)).map(media).join("\n");
    case "image_or_text": return Array.isArray(value) || /^!?\[\[/.test(text(value)) ? media(value) : text(value);
    case "chemical_structure": {const v = note.metadata.structure_image || note.metadata.structure_latex || note.metadata.structure; return v ? transformField("image_or_text", v, note) : "";}
    case "markdown_link_list": return list(value).map(text).filter(Boolean).join("\n\n");
    case "indian_union_territory": return note.path.split("/").at(-2) === "union-territories" ? "Yes" : "No";
    case "us_state_name": {const v = note.lookups?.us_states?.[note.filename.toLowerCase()]; if (!v) throw Error("Unknown US state filename"); return v;}
    case "classical_back": {const composer = label(note.metadata.composer); if (!composer) throw Error("Missing composer"); return `${composer} - ${text(value)}${note.metadata.info ? "\n\n" + text(note.metadata.info) : ""}`;}
    default: throw Error(`Unsupported source transformation: ${name}`);
  }
}
function fieldsFromNote(card, note) {
  const specs = card.source.fields || Object.entries(card.source.field_map || {}).map(([anki, source]) => ({anki, source, transform: "text", required: false}));
  const fields = {};
  for (const spec of specs) {
    let value = spec.source === "$filename" ? note.filename : spec.source === "$body" ? note.body : note.metadata[spec.source];
    if (value === undefined && spec.required && !["blank", "omit"].includes(spec.missing_source) && spec.transform !== "optional_image")
      throw Error(`Missing source field: ${spec.source}`);
    fields[spec.anki] = transformField(spec.transform, value, note);
  }
  for (const key of card.template.required_fields) if (!String(fields[key] ?? "").trim()) throw Error(`Missing required field: ${key}`);
  return fields;
}
function prepareTaxonomy(notes) {
  const normalized = s => s.normalize("NFC").toLowerCase().replace(/\.md$/i, "");
  const exact = new Map(), stems = new Map(), parents = new Map();
  for (const note of notes) {
    const key = normalized(note.path.replace(/^.*?wiki\/life\//, ""));
    exact.set(key,note);const stem=normalized(note.filename);
    stems.set(stem,[...(stems.get(stem)||[]),note]);parents.set(note.path,[]);
  }
  for(const parent of notes) for(const item of [parent.metadata.child,parent.metadata.children].flat().filter(Boolean)) {
    const m=String(item).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if(!m)throw Error(`Invalid taxonomy child: ${item}`);
    const target=normalized(m[1].replace(/^wiki\/life\//,""));
    let child=exact.get(target);
    if(!child){const matches=stems.get(target.split("/").at(-1))||[];if(matches.length>1)throw Error(`Ambiguous taxonomy child: ${item}`);child=matches[0];}
    if(child)parents.get(child.path).push(parent);
  }
  const output=new Map();
  for(const note of notes) {
    const byRank=new Map(),seen=new Set();
    const visit=(n,visiting)=>{
      if(visiting.has(n.path))throw Error("Cycle in taxonomy ancestry");
      if(seen.has(n.path))return;seen.add(n.path);
      const m=n.filename.match(/^(\S+)\s+(.+)$/);if(!m)throw Error("Taxonomy filename must be '<rank> <scientific name>'");
      const key=m[1].toLowerCase();byRank.set(key,[...new Set([...(byRank.get(key)||[]),m[2]])]);
      for(const p of parents.get(n.path))visit(p,new Set([...visiting,n.path]));
    };visit(note,new Set());
    const [rank,...scientific]=note.filename.split(" ");
    const get=r=>(byRank.get(r)||[]).join("; ");
    const kingdom=get("kingdom");let family=get("family");
    if(kingdom.toLowerCase()==="plantae")family=[family,get("subfamily"),get("tribe")].filter(Boolean).join(" - ");
    const familyDisplay=family&&kingdom?`${family} (${kingdom})`:family||(kingdom?`(${kingdom})`:"");
    output.set(note.path,{...note.metadata,$taxonomy_rank:rank,$taxonomy_scientific_name:scientific.join(" "),$taxonomy_genus:get("genus"),$taxonomy_family:familyDisplay});
  }
  return output;
}
function dayNumber(now, timing) {
  return Math.round((Date.parse(studyDay(now, timing)) - Date.parse(timing.day_zero)) / 86400000);
}
function cardSuspended(card, value) {
  return card.card_settings?.suspended ?? ((value?.state?.queue ?? card.queue) === -1);
}
function queueKind(card, value, manifest, now, today = dayNumber(now, manifest.timing)) {
  if (card.retired || card.card_settings?.suspended === true) return null;
  const state = value?.state;
  let q = state?.queue ?? card.queue;
  if (q === -1 && card.card_settings?.suspended === false)
    q = card.card_type === 0 ? 0 : card.card_type === 2 ? 2 : card.scheduling?.due > 1e9 ? 1 : 3;
  const lastUnburied = manifest.scheduling?.collection.lastUnburied ?? 0;
  if ((q === -2 || q === -3) && (today > lastUnburied || today + 7 < lastUnburied))
    q = card.card_type === 0 ? 0 : card.card_type === 2 ? 2 : card.scheduling?.due > 1e9 ? 1 : 3;
  if (q < 0) return null;
  if (q === 0) return "new";
  if (q === 1) return (state?.due ?? card.due_ms) < now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 4) return (state?.due ?? card.due_ms) <= now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 2 || q === 3) {
    const dueDay = state?.anki_due ?? card.anki_due;
    const due = dueDay !== undefined ? dueDay <= today : state?.due <= now;
    return due ? q === 3 ? "interday" : "review" : null;
  }
  return null;
}
function deckTree(cards, states, manifest, now, activity = [], aggregates = null) {
  const meta = manifest.scheduling;
  if (!meta) return [];
  const today = dayNumber(now, manifest.timing);
  const nodes = new Map(Object.values(meta.decks).map(deck => [deck.id, {...deck, children: [],
    new: 0, review: 0, intraday: 0, interday: 0, errors: 0, total: 0}]));
  if(aggregates)for(const [id,raw] of aggregates.raw){const node=nodes.get(id);if(node)for(const key of ["new","review","intraday","interday","errors","total"])node[key]=raw[key]||0;}
  for (const c of cards) {
    if (c.retired) continue;
    const node = nodes.get(c.deck_id);
    if (!node) continue;
    node.total++;
    if (c.content_error) node.errors++;
    const kind = queueKind(c, states.get(c.id), manifest, now, today);
    if (kind) node[kind]++;
  }
  const roots = [];
  for (const n of nodes.values()) (nodes.get(n.parent_id)?.children || roots).push(n);
  const added = aggregates?.added || new Map(), introduced = new Set();
  const byCard = new Map(cards.map(c => [c.id, c]));
  const currentDay = studyDay(now, manifest.timing);
  for (const event of activity) {
    if (event.kind === "historical_review" || event.kind === "scheduling_baseline" || studyDay(event.review_time_ms, manifest.timing) !== currentDay) continue;
    const card = byCard.get(event.card_id);
    if (!card) continue;
    if (event.was_new && introduced.has(card.id)) continue;
    if (event.was_new) introduced.add(card.id);
    let node = nodes.get(card.original_deck_id || card.deck_id);
    while (node) {
      const value = added.get(node.id) || {new: 0, review: 0};
      if (event.was_new) value.new++;
      else if (event.was_review ?? event.state.state === State.Review) value.review++;
      added.set(node.id, value);
      node = nodes.get(node.parent_id);
    }
  }
  const visit = (n, parent) => {
    const preset = meta.presets[n.normal.config_id || "1"]?.settings;
    let limits = {new: 9999, review: 9999};
    if (!n.filtered && preset) {
      const limit = (kind, fallback) => {
        const override = n.normal[`${kind}_limit_today`];
        return override && (override.today ?? 0) === today ? override.limit ?? 0 : n.normal[`${kind}_limit`] ?? fallback;
      };
      const counts = n.common.last_day_studied === today ? n.common : {};
      const extra = added.get(n.id) || {};
      const studiedNew = (counts.new_studied || 0) + (extra.new || 0);
      const studiedReview = (counts.review_studied || 0) + (extra.review || 0);
      limits.review = Math.max(0, limit("review", preset.reviews_per_day) - studiedReview - (meta.collection.newCardsIgnoreReviewLimit ? 0 : studiedNew));
      limits.new = Math.max(0, limit("new", preset.new_per_day) - studiedNew);
      if (!meta.collection.newCardsIgnoreReviewLimit) limits.new = Math.min(limits.new, limits.review);
    }
    if (parent && meta.collection.applyAllParentLimits) {
      limits.new = Math.min(limits.new, parent.new); limits.review = Math.min(limits.review, parent.review);
    }
    n.children.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const child of n.children) {
      visit(child, limits);
      for (const kind of ["new", "review", "intraday", "interday", "errors", "total"]) n[kind] += child[kind];
    }
    n.interday = Math.min(n.interday, limits.review);
    n.review = Math.min(n.review, limits.review - n.interday);
    n.new = Math.min(n.new, limits.new);
    if (!n.filtered && !meta.collection.newCardsIgnoreReviewLimit) n.new = Math.min(n.new, limits.review - n.interday - n.review);
    n.learning = n.intraday + n.interday;
  };
  roots.sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  roots.forEach(n => visit(n, null));
  return roots.filter(n => !(n.id === "1" && n.total === 0 && !n.children.length && roots.length > 1));
}
function reviewQueueV2(cards, states, events, manifest, now, group, introducedCount, deckId = null, skipped = new Set(), cardFilter = null, precomputedTree = null, context = null) {
  if (!manifest.scheduling) return reviewQueue(cards, states, events, manifest, now, group, introducedCount);
  const tree = precomputedTree || deckTree(cards, states, manifest, now, events);
  const nodesById = context?.nodesById || new Map(), kinds = context?.kinds || new Map(), today = dayNumber(now, manifest.timing);
  const kindOf = c => {
    if (!kinds.has(c.id)) kinds.set(c.id, queueKind(c, states.get(c.id), manifest, now, today));
    return kinds.get(c.id);
  };
  const find = nodes => {for (const n of nodes) {nodesById.set(n.id,n); find(n.children);}};
  if(!nodesById.size)find(tree);
  const node = nodesById.get(deckId);
  const selected = node ? [node] : tree;
  const allowed = new Map();
  const allocate = n => {
    const ids = new Set();
    const gather = p => {ids.add(p.id); p.children.forEach(gather);}; gather(n);
    const eligible = cards.filter(c => ids.has(c.deck_id) && (!group || c.group === group) && (!cardFilter || cardFilter(c)) && states.has(c.id));
    const budget = {new:n.new,review:n.review,interday:n.interday,intraday:n.intraday};
    eligible.sort((a,b) => Number(skipped.has(a.id))-Number(skipped.has(b.id)) || (a.anki_due ?? 0) - (b.anki_due ?? 0) || a.id.localeCompare(b.id));
    const used = new Map();
    for (const kind of ["intraday", "interday", "review", "new"]) for (const c of eligible) {
      if (budget[kind] <= 0 || kindOf(c) !== kind) continue;
      let path = manifest.scheduling.decks[c.deck_id], ok = true;
      const ancestors = [];
      while (path) {
        ancestors.push(path.id);
        const entry = used.get(path.id) || {new:0,review:0,interday:0,intraday:0};
        const target = nodesById.get(path.id);
        if (target && entry[kind] >= target[kind]) ok = false;
        if (path.id === n.id) break;
        path = manifest.scheduling.decks[path.parent_id];
      }
      if (!ok) continue;
      for (const id of ancestors) {const entry = used.get(id) || {new:0,review:0,interday:0,intraday:0};entry[kind]++;used.set(id,entry);}
      budget[kind]--; allowed.set(c.id,c);
    }
  };
  selected.forEach(allocate);
  const chosen = [...allowed.values()];
  const priority = c => {
    const kind=kindOf(c);
    return kind==="intraday" ? (states.get(c.id).state.due>now?4:0) : kind==="interday"?1:kind==="review"?2:3;
  };
  chosen.sort((a,b)=>priority(a)-priority(b) || (states.get(a.id).state.due||0)-(states.get(b.id).state.due||0) || a.id.localeCompare(b.id));
  return {cards: chosen, fresh: chosen.filter(c => kindOf(c) === "new").length,
    learning:chosen.filter(c => ["intraday","interday"].includes(kindOf(c))).length,
    review:chosen.filter(c => kindOf(c) === "review").length, tree};
}
function nextStateV2(card, current, options, manifest, now, rating) {
  if (![1,2,3,4].includes(rating)) throw Error("Invalid rating");
  if (current.last_review !== undefined && now < current.last_review) throw Error("Device clock precedes last review");
  if (manifest.scheduling?.decks[card.deck_id]?.filtered) throw Error("Filtered-deck answering requires returning cards to their original deck in Anki before migration");
  const engine = schedulerV2(options);
  // Anki measures whole 24-hour periods back from the next cutoff, using
  // today's UTC offset. Counting historical local dates differs across DST.
  const clock = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:manifest.timing.timezone,
    hour:"numeric", minute:"numeric", second:"numeric", hourCycle:"h23"})
    .formatToParts(new Date(now)).map(p => [p.type,p.value]));
  const sinceMidnight = +clock.hour * 3600 + +clock.minute * 60 + +clock.second;
  const untilRollover = (manifest.timing.rollover_hour * 3600 - sinceMidnight + 86400) % 86400 || 86400;
  const nextCutoff = Math.floor(now / 1000) + untilRollover;
  const elapsed = current.last_review === undefined ? 0 :
    Math.max(0, Math.floor((nextCutoff - Math.floor(current.last_review / 1000)) / 86400));
  const memories = [1,2,3,4].map(r => engine.next_state(current.state===State.New ? null : {stability:current.stability,difficulty:current.difficulty},elapsed,r));
  const interval = m => m.stability * engine.intervalModifier;
  const capped = (value,min=1) => Math.min(options.maximum_interval,Math.max(min,Math.round(value)));
  const memory = memories[rating-1];
  const state = {...current,stability:memory.stability,difficulty:memory.difficulty,elapsed_days:elapsed,
    last_review:now,reps:current.reps+1,lapses:current.lapses,queue:2,state:State.Review,
    learning_steps:0,remaining_steps:0};
  let seconds, remaining = 0;
  let days = capped(interval(memory));
  const relearning = current.state===State.Relearning || current.state===State.Review && rating===1;
  const steps = relearning ? options.relearning_steps || [10] : options.learning_steps || [1,10];
  if (current.state!==State.Review || rating===1) {
    const total=steps.length;
    const originalRemaining = current.state===State.New || current.state===State.Review ? total :
      current.remaining_steps ?? Math.max(0,total-current.learning_steps);
    const position=Math.max(0,Math.min(total-1,total-originalRemaining));
    if(rating===1 && total) {seconds=Math.trunc(steps[0]*60);remaining=total;}
    else if(rating===2 && total) {
      const delay=Math.trunc(steps[position]*60);
      seconds=position===0 ? total>1 ? Math.trunc((delay+Math.trunc(steps[1]*60))/2) : Math.min(Math.trunc(delay*1.5),delay+86400) : delay;
      if(seconds>86400)seconds=Math.round(seconds/86400)*86400;
      remaining=originalRemaining;
    } else if(rating===3 && position+1<total) {seconds=Math.trunc(steps[position+1]*60);remaining=total-position-1;}
    if(rating===4)days=capped(interval(memory),capped(interval(memories[2]))+1);
    if(seconds===undefined && rating!==4 && (total===0 || options.short_term_with_steps) && interval(memory)<.5) {
      seconds=Math.max(1,Math.trunc(interval(memory)*86400));remaining=originalRemaining;
    }
    if(current.state===State.Review && rating===1)state.lapses++;
  } else {
    const hard=capped(interval(memories[1]));
    const good=capped(interval(memories[2]),hard+1);
    const easy=capped(interval(memories[3]),good+1);
    days=[days,hard,good,easy][rating-1];
  }
  if(seconds!==undefined) {
    state.scheduled_secs=seconds;
    state.state=relearning?State.Relearning:State.Learning;
    state.scheduled_days=relearning ? rating===1?days:current.scheduled_days : 0;
    state.remaining_steps=remaining;state.learning_steps=Math.max(0,steps.length-remaining);
    state.due=now+seconds*1000;
    state.queue=state.due>=studyDayStart(dayNumber(now,manifest.timing)+1,manifest.timing)?3:1;
    if(state.queue===3) {
      state.anki_due=dayNumber(now,manifest.timing)+Math.max(1,Math.round(seconds/86400));
      state.due=studyDayStart(state.anki_due,manifest.timing);
    } else delete state.anki_due;
  } else {
    delete state.scheduled_secs;
    state.scheduled_days=days;state.anki_due=dayNumber(now,manifest.timing)+days;
    state.due=studyDayStart(state.anki_due,manifest.timing);
  }
  return state;
}
function studyDayStart(day, timing) {
  const target = Date.parse(timing.day_zero) + day * 86400000 + timing.rollover_hour * 3600000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:timing.timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    guess += target - Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  }
  return guess;
}
async function readCatalogPartitions(paths,read){
  const results=new Array(paths.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,paths.length)},async()=>{
    while(next<paths.length){const i=next++;results[i]=await read(paths[i]);}
  }));
  return results.flat();
}
// Editable study configuration is independent of imported scheduling baselines.
function composeStudyDocuments(parts) {
  for(const doc of Object.values(parts))if(doc?.format_version!==1)throw Error("Unsupported configuration layout");
  const source_rules={};
  for(const [id,rule] of Object.entries(parts.sources.rules))source_rules[id]={...rule,
    fields:rule.fields.map(f=>{const {name,...rest}=f;return name===undefined?rest:{...rest,anki:name};}),...parts.cards.rules[id]};
  return validateStudy({format_version:1,profiles:parts.profiles.profiles,default_profile:parts.profiles.default_profile,
    source_rules,decks:parts.decks.decks,profile_rules:parts.assignments.rules});
}
function hydrateCatalog(cards,notes,study) {
  const bindings=new Map(notes.map(n=>[n.id,n]));
  if(bindings.size!==notes.length)throw Error("Duplicate SRS note binding");
  return cards.map(card=>{
    const note=bindings.get(card.note_id);if(!note)throw Error(`Missing SRS note binding: ${card.note_id}`);
    const rule=study?.source_rules[note.rule_id];
    const source=note.locator?{...note.locator}:null;
    if(source){if(!rule)source.error=`Missing source rule: ${note.rule_id}`;
      else {source.fields=rule.fields;if(rule.prepare)source.prepare=rule.prepare;}}
    return {...card,group:note.rule_id,note_uid:note.uid,source};
  });
}
function validateStudyFilter(query) {
  if(!query || typeof query!=="object" || Array.isArray(query))throw Error("Filter must be an object");
  const allowed=["all","any","not","paths","deck_ids","include_children","groups","templates","tags","properties","card_ids"];
  for(const key of Object.keys(query))if(!allowed.includes(key))throw Error(`Unknown filter field: ${key}`);
  for(const key of ["all","any"])if(key in query){if(!Array.isArray(query[key])||!query[key].length)throw Error(`Invalid ${key} filter`);query[key].forEach(validateStudyFilter);}
  if("not" in query)validateStudyFilter(query.not);
  for(const key of ["paths","deck_ids","groups","templates","tags","card_ids"])if(key in query && (!Array.isArray(query[key])||query[key].some(x=>typeof x!=="string"||!x)))throw Error(`Invalid ${key} filter`);
  if("include_children" in query && typeof query.include_children!=="boolean")throw Error("Invalid include_children filter");
  if("properties" in query){
    if(!query.properties || typeof query.properties!=="object" || Array.isArray(query.properties))throw Error("Invalid properties filter");
    for(const value of Object.values(query.properties))if(value && typeof value==="object" && !Array.isArray(value) && (Object.keys(value).join()!=="exists"||typeof value.exists!=="boolean"))throw Error("Unknown property filter operator");
  }
}
function matchesStudyFilter(card,query,manifest) {
  if(query.all && !query.all.every(q=>matchesStudyFilter(card,q,manifest)))return false;
  if(query.any && !query.any.some(q=>matchesStudyFilter(card,q,manifest)))return false;
  if(query.not && matchesStudyFilter(card,query.not,manifest))return false;
  const path=card.source?.path||"";
  if(query.paths && !query.paths.some(p=>path===p||path.startsWith(p.replace(/\/$/,"")+"/")))return false;
  for(const [key,value] of [["groups",card.group],["templates",card.template_key],["card_ids",card.id]])if(query[key] && !query[key].includes(value))return false;
  if(query.deck_ids){
    let deck=manifest.scheduling.decks[card.deck_id];const ids=new Set([card.deck_id]);
    while(query.include_children && deck?.parent_id){ids.add(deck.parent_id);deck=manifest.scheduling.decks[deck.parent_id];}
    if(!query.deck_ids.some(id=>ids.has(id)))return false;
  }
  const tags=new Set([...(card.source_tags||[]),...(card.card_settings?.tags||[])]);
  if(query.tags && !query.tags.every(tag=>tags.has(tag)))return false;
  for(const [key,expected] of Object.entries(query.properties||{})) {
    if(expected && typeof expected==="object" && !Array.isArray(expected)){
      if(Object.hasOwn(card.properties||{},key)!==expected.exists)return false;
    }else if(canonical(card.properties?.[key])!==canonical(expected))return false;
  }
  return true;
}
function validateStudy(config) {
  if(config?.format_version!==1||!config.profiles||!Object.keys(config.profiles).length||!config.profiles[config.default_profile])throw Error("Invalid study configuration");
  for(const [id,profile] of Object.entries(config.profiles)){
    if(!id)throw Error("Empty profile ID");
    validateOptions(profile.settings);validateSchedulerConfig({scheduler_version:SCHEDULER_VERSION,settings:profile.settings});
    if(!Number.isSafeInteger(profile.reviews_per_day)||profile.reviews_per_day<0)throw Error(`Invalid review limit: ${id}`);
    for(const key of ["learning_steps","relearning_steps"])if(!Array.isArray(profile.settings[key])||profile.settings[key].some(v=>!Number.isFinite(v)||v<=0))throw Error(`Invalid steps: ${id}`);
  }
  for(const rule of config.profile_rules||[]){if(!config.profiles[rule.profile])throw Error("Unknown assignment profile");validateStudyFilter(rule.filter);}
  for(const [id,deck] of Object.entries(config.decks||{})){
    if(typeof deck.name!=="string"||!deck.name.trim())throw Error("Decks need a nonempty name");
    validateStudyFilter(deck.filter);const seen=new Set([id]);let parent=deck.parent_id;
    while(parent!=null){if(!config.decks[parent]||seen.has(parent))throw Error("Missing parent or cycle in study decks");seen.add(parent);parent=config.decks[parent].parent_id;}
  }
  for(const rule of Object.values(config.source_rules||{})){
    if(!config.profiles[rule.profile]||!Array.isArray(rule.sources)||!rule.sources.length||rule.sources.some(p=>typeof p!=="string"||!p||p.startsWith("/")||p.split("/").includes("..")))throw Error("Invalid source rule");
    if(rule.filter)validateStudyFilter(rule.filter);
  }
  return config;
}
function studyProfileId(card,config,manifest) {
  const home=card.original_deck_id?{...card,deck_id:card.original_deck_id}:card;
  const id=card.card_settings?.profile || (config.profile_rules||[]).find(r=>matchesStudyFilter(home,r.filter,manifest))?.profile || card.profile_id || config.default_profile;
  if(!config.profiles[id])throw Error(`Unknown scheduling profile: ${id}`);
  return id;
}
function studyDeckMatches(card,id,config,manifest) {
  if(card.retired)return false;
  const deck=config.decks[id];if(!deck)throw Error(`Unknown study deck: ${id}`);
  if(matchesStudyFilter(card,deck.filter,manifest))return true;
  return Object.entries(config.decks).some(([child,d])=>d.parent_id===id && studyDeckMatches(card,child,config,manifest));
}
function studyRuntimeManifest(original,config) {
  const meta=JSON.parse(JSON.stringify(original.scheduling));
  for(const [id,profile] of Object.entries(config.profiles)){
    const o=profile.settings, preset={id:`profile:${id}`,settings:{new_per_day:o.new_cards_per_day,reviews_per_day:profile.reviews_per_day,
      desired_retention:o.desired_retention,maximum_review_interval:o.maximum_interval,minimum_lapse_interval:o.minimum_interval,
      learn_steps:o.learning_steps,relearn_steps:o.relearning_steps}};
    meta.presets[preset.id]=preset;
    if(profile.imported_preset && meta.presets[profile.imported_preset])meta.presets[profile.imported_preset].settings={...meta.presets[profile.imported_preset].settings,...preset.settings};
    const home=`profile:${id}`;
    meta.decks[home]={id:home,name:profile.name||id,parent_id:null,normal:{config_id:preset.id},common:{},filtered:false};
  }
  return {...original,scheduling:meta,study:config};
}
// Resolve direct filters once, then union children without counting a card twice.
function studyMemberships(cards,config,manifest){
  const result=new Map(),children=new Map();
  for(const [id,deck] of Object.entries(config.decks)){
    result.set(id,new Set());
    if(!children.has(deck.parent_id))children.set(deck.parent_id,[]);
    children.get(deck.parent_id).push(id);
  }
  for(const card of cards)if(!card.retired)for(const [id,deck] of Object.entries(config.decks))if(matchesStudyFilter(card,deck.filter,manifest))result.get(id).add(card.id);
  const merge=id=>{const target=result.get(id);for(const child of children.get(id)||[])for(const cid of merge(child))target.add(cid);return target;};
  for(const id of children.get(null)||[])merge(id);
  // Root parent_id may be omitted in older documents.
  for(const id of children.get(undefined)||[])merge(id);
  return result;
}
function studyDeckTree(cards,states,manifest,now,activity,skipped,group,memberships) {
  memberships=memberships||studyMemberships(cards,manifest.study,manifest);
  const config=manifest.study, base=deckTree(cards,states,manifest,now,activity);
  const queueContext={nodesById:new Map(),kinds:new Map()};
  const native=new Map();const visit=nodes=>nodes.forEach(n=>{native.set(n.id,n);visit(n.children);});visit(base);
  const nodes=new Map();
  for(const [id,deck] of Object.entries(config.decks)){
    // Imported hierarchy filters can reuse the native counts without rescanning the catalog.
    const descendants=[];const gather=parent=>{for(const [child,d] of Object.entries(config.decks))if(d.parent_id===parent){descendants.push(d);gather(child);}};gather(id);
    const q=deck.filter, direct=Object.keys(q).length===2 && q.include_children===true && q.deck_ids?.length===1 &&
      !descendants.some(d=>!d.filter.deck_ids?.every(x=>native.get(x)?.name.startsWith((native.get(q.deck_ids[0])?.name||"\0")+"::")));
    const target=direct && !group && native.get(q.deck_ids[0]);
    const queue=target || reviewQueueV2(cards,states,activity,manifest,now,group,undefined,null,skipped,c=>memberships.get(id).has(c.id),base,queueContext);
    const matching=target ? null : cards.filter(c=>(!group||c.group===group)&&memberships.get(id).has(c.id));
    nodes.set(id,{id,...deck,children:[],new:queue.new??queue.fresh,learning:queue.learning,review:queue.review,
      errors:target?target.errors:matching.filter(c=>c.content_error).length,total:target?target.total:matching.length});
  }
  const roots=[];for(const node of nodes.values())(nodes.get(node.parent_id)?.children||roots).push(node);
  const sort=nodes=>{nodes.sort((a,b)=>a.name.localeCompare(b.name));nodes.forEach(n=>sort(n.children));};sort(roots);return roots;
}
function sourceBlocks(text) {
  const pattern=/^[ \t]{0,3}>[ \t]*\[!(?:anki|srs)\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n((?:^[ \t]{0,3}>[ \t]?(?!\[!(?:anki|srs)\](?:-|[ \t]))[^\r\n]*(?:\r?\n|$))+)((?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)/gmi;
  return [...text.matchAll(pattern)].flatMap(m=>{
    const markers=[...m[3].matchAll(/<!--[ \t]*(ID|SRS-ID)[ \t]*:[ \t]*([^\r\n]+?)[ \t]*-->/gi)];
    const anki=[...new Set(markers.filter(x=>x[1].toUpperCase()==="ID").map(x=>String(BigInt(x[2].trim()))))];
    const local=[...new Set(markers.filter(x=>x[1].toUpperCase()==="SRS-ID").map(x=>x[2].trim().toLowerCase()))];
    if(anki.length>1 || (!anki.length && local.length>1))throw Error("Conflicting block identities");
    if(!anki.length && !local.length)return [];
    return [{identity:anki.length?`anki:${anki[0]}`:`local:${local[0]}`,
      front:m[1].trim(),tags:[...new Set([...m[2].matchAll(/(?<![\w/])#([\p{L}\p{N}_/-]+)/gu)].map(t=>t[1]))],back:m[2].split(/\r?\n/).map(l=>l.replace(/^[ \t]{0,3}>[ \t]?/,"")).filter(l=>!/^\s*(?:#[^\s#]+\s*)+$/.test(l)).join("\n").trim()}];
  });
}
// In-memory scheduling index. Catalog scans belong to construction, not navigation.
const INDEX_KINDS = ["new", "review", "intraday", "interday"];
const indexZeros = () => ({new:0,review:0,intraday:0,interday:0,total:0,errors:0});
const indexOrder = (a,b) => (a.anki_due??0)-(b.anki_due??0)||a.id.localeCompare(b.id);
class SchedulingOrder {
  constructor(compare=indexOrder){this.root=null;this.compare=compare;}
  priority(id){let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return h>>>0;}
  fix(n){if(!n)return n;n.size=1+(n.left?.size||0)+(n.right?.size||0);n.best=n.card;for(const child of [n.left,n.right])if(child&&this.compare(child.best,n.best)<0)n.best=child.best;return n;}
  rotate(n,right){const p=n[right?'left':'right'];n[right?'left':'right']=p[right?'right':'left'];p[right?'right':'left']=this.fix(n);return this.fix(p);}
  insert(card){
    const add=n=>{if(!n)return this.fix({card,priority:this.priority(card.id),left:null,right:null});const cmp=indexOrder(card,n.card);if(!cmp){n.card=card;return this.fix(n);}const side=cmp<0?'left':'right';n[side]=add(n[side]);return n[side].priority<n.priority?this.rotate(n,cmp<0):this.fix(n);};
    this.root=add(this.root);
  }
  remove(card){
    const del=n=>{if(!n)return null;const cmp=indexOrder(card,n.card);if(cmp<0)n.left=del(n.left);else if(cmp>0)n.right=del(n.right);else{if(!n.left)return n.right;if(!n.right)return n.left;const right=n.left.priority<n.right.priority;n=this.rotate(n,right);n[right?'right':'left']=del(n[right?'right':'left']);}return this.fix(n);};
    this.root=del(this.root);
  }
  bulk(cards){
    const stack=[];
    for(const card of cards){const node={card,priority:this.priority(card.id),left:null,right:null};let last=null;while(stack.length&&stack.at(-1).priority>node.priority)last=stack.pop();node.left=last;if(stack.length)stack.at(-1).right=node;stack.push(node);}
    this.root=stack[0]||null;const finish=n=>{if(n){finish(n.left);finish(n.right);this.fix(n);}};finish(this.root);
  }
  rank(card){let n=this.root,total=0;while(n){if(indexOrder(n.card,card)<=0){total+=1+(n.left?.size||0);n=n.right;}else n=n.left;}return total;}
  bestThrough(bound){
    if(!bound)return this.root?.best;
    let n=this.root,best;const take=c=>{if(c&&(!best||this.compare(c,best)<0))best=c;};
    while(n){if(indexOrder(n.card,bound)<=0){take(n.left?.best);take(n.card);n=n.right;}else n=n.left;}return best;
  }
}
class SchedulingIndex {
  constructor(cards,states,manifest,activity,now,memberships){
    this.cards=new Map(cards.map(c=>[c.id,c]));this.states=states;this.manifest=manifest;this.now=now;this.today=dayNumber(now,manifest.timing);
    this.scopes=new Map();this.reverse=new Map();this.roots=new Map();this.nativeDecksByRoot=new Map();this.rootScopes=new Map();this.added=new Map();this.introduced=new Set();this.kinds=new Map();this.wakes=[];this.versions=new Map();
    this.stats={catalogCards:0,cardUpdates:0,countUpdates:0,queueReads:0};this.buried=new Set();this.ordering=new Map();this.building=true;
    this.deckOrder=Object.entries(manifest.study?.decks||{}).sort(([,a],[,b])=>a.name.localeCompare(b.name));
    for(const deck of Object.values(manifest.scheduling.decks)){let root=deck;while(root.parent_id)root=manifest.scheduling.decks[root.parent_id];this.roots.set(deck.id,root.id);if(!this.nativeDecksByRoot.has(root.id))this.nativeDecksByRoot.set(root.id,{});this.nativeDecksByRoot.get(root.id)[deck.id]=deck;}
    const memberDecks=new Map();
    if(manifest.study){for(const [id,ids] of memberships||studyMemberships(cards,manifest.study,manifest))for(const cid of ids){if(!memberDecks.has(cid))memberDecks.set(cid,[]);memberDecks.get(cid).push(id);}}
    else for(const card of cards){const ids=[];let deck=manifest.scheduling.decks[card.deck_id];while(deck){ids.push(deck.id);deck=manifest.scheduling.decks[deck.parent_id];}memberDecks.set(card.id,ids);}
    for(const card of [...cards].sort(indexOrder)){
      this.stats.catalogCards++;
      const keys=[];for(const id of [null,...(memberDecks.get(card.id)||[])])for(const group of ['',...(card.group?[card.group]:[])]){
        const key=JSON.stringify([id,group]);keys.push(key);
        if(!this.scopes.has(key))this.scopes.set(key,{id,group,buckets:new Map(),counts:null,orders:Object.fromEntries(INDEX_KINDS.map(k=>[k,new SchedulingOrder((a,b)=>this.compareDue(a,b))]))});
        const root=this.roots.get(card.deck_id);if(!this.rootScopes.has(root))this.rootScopes.set(root,new Set());this.rootScopes.get(root).add(key);
      }
      this.reverse.set(card.id,keys);this.change(card,1);this.scheduleWake(card);
    }
    this.building=false;
    for(const scope of this.scopes.values())for(const orders of [scope.orders,...[...scope.buckets.values()].map(b=>b.orders)])for(const order of Object.values(orders)){order.bulk(order.pending||[]);delete order.pending;}
    for(const event of activity)this.addActivity(event);
    this.refreshCounts(new Set(this.scopes.keys()));
  }
  key(id,group=''){return JSON.stringify([id??null,group||'']);}
  bucket(scope,id){if(!scope.buckets.has(id))scope.buckets.set(id,{...indexZeros(),orders:Object.fromEntries(INDEX_KINDS.map(k=>[k,new SchedulingOrder((a,b)=>this.compareDue(a,b))]))});return scope.buckets.get(id);}
  change(card,delta){
    if(card.retired)return;
    const kind=delta>0?queueKind(card,this.states.get(card.id),this.manifest,this.now,this.today):this.kinds.get(card.id);
    if(delta>0){this.kinds.set(card.id,kind);const state=this.states.get(card.id)?.state;this.ordering.set(card.id,{priority:kind==='intraday'?(state.due>this.now?4:0):kind==='interday'?1:kind==='review'?2:3,due:state?.due||0});}
    for(const key of this.reverse.get(card.id)||[]){const b=this.bucket(this.scopes.get(key),card.deck_id);b.total+=delta;if(card.content_error)b.errors+=delta;if(kind){b[kind]+=delta;if(delta>0&&!this.buried.has(card.id)){for(const order of [b.orders[kind],this.scopes.get(key).orders[kind]]){if(this.building)(order.pending??=[]).push(card);else order.insert(card);}}else{b.orders[kind].remove(card);this.scopes.get(key).orders[kind].remove(card);}}}
    if(delta>0)this.kinds.set(card.id,kind);
  }
  addActivity(event){
    if(event.kind==='historical_review'||event.kind==='scheduling_baseline'||event.kind==='card_settings'||studyDay(event.review_time_ms,this.manifest.timing)!==studyDay(this.now,this.manifest.timing))return;
    const card=this.cards.get(event.card_id);if(!card||event.was_new&&this.introduced.has(card.id))return;
    if(event.was_new)this.introduced.add(card.id);
    let deck=this.manifest.scheduling.decks[card.original_deck_id||card.deck_id];
    while(deck){const value=this.added.get(deck.id)||{new:0,review:0};if(event.was_new)value.new++;else if(event.was_review??event.state?.state===State.Review)value.review++;this.added.set(deck.id,value);deck=this.manifest.scheduling.decks[deck.parent_id];}
  }
  nativeTree(){
    if(!this.native){const raw=this.scopes.get(this.key(null))?.buckets||new Map();this.native=deckTree([],this.states,this.manifest,this.now,[],{raw,added:this.added});}
    return this.native;
  }
  indexNativeRoots(){
    this.nativeById=new Map();this.nativeRootPositions=new Map();
    const visit=n=>{this.nativeById.set(n.id,n);n.children.forEach(visit);};
    this.native.forEach((n,i)=>{this.nativeRootPositions.set(n.id,i);visit(n);});
  }
  updateNativeRoots(roots){
    if(!this.native){this.nativeTree();this.indexNativeRoots();return;}
    if(!roots)return;
    const raw=this.scopes.get(this.key(null))?.buckets||new Map();
    for(const root of roots){
      const decks=this.nativeDecksByRoot.get(root);if(!decks)continue;
      const localRaw=new Map(Object.keys(decks).map(id=>[id,raw.get(id)||indexZeros()]));
      const manifest={...this.manifest,scheduling:{...this.manifest.scheduling,decks}};
      const node=deckTree([],this.states,manifest,this.now,[],{raw:localRaw,added:this.added})[0];
      const position=this.nativeRootPositions.get(root);
      if(position!==undefined){this.native[position]=node;const visit=n=>{this.nativeById.set(n.id,n);n.children.forEach(visit);};visit(node);}
    }
  }
  selectedRoots(scope,roots){
    if(this.manifest.study||!scope.id)return roots?[...roots].map(id=>this.nativeById.get(id)).filter(Boolean):this.nativeTree();
    if(roots&&!roots.has(this.roots.get(scope.id)))return [];
    const node=this.nativeById.get(scope.id);return node?[node]:[];
  }
  computeCounts(scope,roots){
    const count=n=>{const b=scope.buckets.get(n.id)||indexZeros(),v={...b};for(const child of n.children){const c=count(child);for(const k of INDEX_KINDS)v[k]+=c[k];v.total+=c.total;v.errors+=c.errors;}for(const k of INDEX_KINDS)v[k]=Math.min(v[k],n[k]);return v;};
    scope.rootCounts??=new Map();const out=scope.counts||indexZeros();
    for(const root of this.selectedRoots(scope,roots)){
      const value=count(root),previous=scope.rootCounts.get(root.id)||indexZeros();
      for(const k of [...INDEX_KINDS,'total','errors'])out[k]+=value[k]-previous[k];
      scope.rootCounts.set(root.id,value);
    }
    this.stats.countUpdates++;return {...out,fresh:out.new,learning:out.intraday+out.interday};
  }
  refreshCounts(keys,roots){this.updateNativeRoots(roots);for(const key of keys){const scope=this.scopes.get(key);if(scope)scope.counts=this.computeCounts(scope,roots);}}
  counts(id=null,group=''){return this.scopes.get(this.key(id,group))?.counts||{...indexZeros(),fresh:0,learning:0};}
  tree(group=''){
    if(!this.manifest.study){const copy=nodes=>nodes.map(n=>({...n,...this.counts(n.id,group),children:copy(n.children)}));return copy(this.nativeTree());}
    const nodes=new Map();for(const [id,deck] of this.deckOrder)nodes.set(id,{id,...deck,...this.counts(id,group),children:[]});
    const roots=[];for(const node of nodes.values())(nodes.get(node.parent_id)?.children||roots).push(node);
    return roots;
  }
  compareDue(a,b){
    const x=this.ordering.get(a.id),y=this.ordering.get(b.id);
    return x.priority-y.priority||x.due-y.due||a.id.localeCompare(b.id);
  }
  bury(id){
    if(this.buried.has(id))return;this.buried.add(id);
    const card=this.cards.get(id),kind=this.kinds.get(id);if(!kind)return;
    for(const key of this.reverse.get(id)||[]){const scope=this.scopes.get(key);scope.buckets.get(card.deck_id).orders[kind].remove(card);scope.orders[kind].remove(card);}
  }
  queue(id=null,group=''){
    this.stats.queueReads++;const scope=this.scopes.get(this.key(id,group));if(!scope)return {...this.counts(id,group),cards:[]};
    let best;const take=c=>{if(c&&(!best||this.compareDue(c,best)<0))best=c;};
    for(const kind of INDEX_KINDS){
      // A node's allowance selects a prefix in Anki allocation order. Rank and
      // prefix-min queries find its next card without materializing that prefix.
      const count=(n,bound)=>{let value=bound?scope.buckets.get(n.id)?.orders[kind].rank(bound)||0:scope.buckets.get(n.id)?.orders[kind].root?.size||0;for(const child of n.children)value+=count(child,bound);return Math.min(value,n[kind]);};
      const boundary=(n,limit)=>{let at=scope.orders[kind].root,result;while(at){if(count(n,at.card)>=limit){result=at.card;at=at.left;}else at=at.right;}return result;};
      const visit=(n,bound)=>{
        if(!n[kind])return;
        let available=bound?scope.buckets.get(n.id)?.orders[kind].rank(bound)||0:scope.buckets.get(n.id)?.orders[kind].root?.size||0;
        for(const child of n.children)available+=count(child,bound);
        if(available>n[kind])bound=boundary(n,n[kind]);
        take(scope.buckets.get(n.id)?.orders[kind].bestThrough(bound));
        for(const child of n.children)visit(child,bound);
      };
      for(const root of this.selectedRoots(scope))visit(root,null);
    }
    return {...scope.counts,cards:best?[best]:[]};
  }
  update(card,value,event){
    const previous=this.cards.get(card.id);this.change(previous,-1);this.cards.set(card.id,card);if(value)this.states.set(card.id,value);this.change(card,1);this.scheduleWake(card);if(event)this.addActivity(event);this.stats.cardUpdates++;
    // Shared parent/preset allowances can change sibling counts too.
    const roots=new Set([this.roots.get(previous.deck_id),this.roots.get(card.deck_id),this.roots.get(card.original_deck_id||card.deck_id)]);
    const keys=new Set();for(const root of roots)for(const key of this.rootScopes.get(root)||[])keys.add(key);this.refreshCounts(keys,roots);
  }
  scheduleWake(card){
    const version=(this.versions.get(card.id)||0)+1;this.versions.set(card.id,version);
    const state=this.states.get(card.id)?.state,q=state?.queue??card.queue,due=state?.due??card.due_ms;
    const times=q===1||q===4?[due-(this.manifest.scheduling.collection.collapseTime??1200)*1000+(q===1?1:0),due]:[2,3].includes(q)&&state?.anki_due===undefined&&card.anki_due===undefined?[due]:[];
    for(const time of times)if(time>this.now){const entry={time,id:card.id,version};this.wakes.push(entry);let i=this.wakes.length-1;while(i){const p=(i-1)>>1;if(this.wakes[p].time<=time)break;this.wakes[i]=this.wakes[p];i=p;}this.wakes[i]=entry;}
  }
  advance(now){
    if(dayNumber(now,this.manifest.timing)!==this.today)return false;
    this.now=now;
    while(this.wakes[0]?.time<=now){const first=this.wakes[0],last=this.wakes.pop();if(this.wakes.length){this.wakes[0]=last;let i=0;while(true){let c=i*2+1;if(c>=this.wakes.length)break;if(c+1<this.wakes.length&&this.wakes[c+1].time<this.wakes[c].time)c++;if(this.wakes[i].time<=this.wakes[c].time)break;[this.wakes[i],this.wakes[c]]=[this.wakes[c],this.wakes[i]];i=c;}}if(this.versions.get(first.id)===first.version)this.update(this.cards.get(first.id));}
    return true;
  }
  get nextWake(){return this.wakes[0]?.time??Infinity;}
}

  if (globalThis.__SRS_TEST__) {
    globalThis.SRS = {SchedulingIndex, SchedulingOrder, readCatalogPartitions, studyMemberships, composeStudyDocuments, hydrateCatalog, sourceBlocks, validateStudy, validateStudyFilter, matchesStudyFilter, studyProfileId, studyRuntimeManifest, studyDeckTree, studyDeckMatches, schedulerV2, effectiveSettings, renderV2, resolveImageEmbeds, transformField, fieldsFromNote,
      deckTree, queueKind, reviewQueueV2, nextStateV2, studyDay, studyDayStart, dayNumber, cardSuspended,
      ReviewIndex, appendReview, validateEvent, saveSchedulerConfig, verifySchedulerConfig, parseCSV, indexRows, configuredCards, initialState};
    return;
  }
  (async () => {
    const api = dv.app, component = dv.component;
    const root = input?.root || "ankobs-srs", dataRoot = `${root}/data`;
    const identity = `ankobs-srs:${api.vault.getName()}:${root}`;
    const host = dv.container.createDiv({cls:"ankobs-srs"});
    const notice = host.createDiv({cls:"srs-notice",attr:{role:"status","aria-live":"polite"}}), controls = host.createDiv({cls:"srs-toolbar"});
    const home = controls.createEl("button",{text:"Decks"});
    const manage = controls.createEl("button",{text:"Cards"});
    const profilesButton=controls.createEl("button",{text:"Profiles"});
    const sourcesButton=controls.createEl("button",{text:"Sources"});
    const select = controls.createEl("select",{attr:{"aria-label":"Template group"}});
    const tools = controls.createEl("details",{cls:"srs-tools"});
    tools.createEl("summary",{text:"Tools"});
    const toolBody = tools.createDiv();
    const deviceSelect = toolBody.createEl("select",{attr:{"aria-label":"This device"}});
    const refresh = toolBody.createEl("button",{text:"Refresh"});
    const rebuild = toolBody.createEl("button",{text:"Rebuild local index"});
    const content = host.createDiv({cls:"srs-content"});
    const context = content.createDiv({cls:"srs-context"});
    const counts = content.createDiv({cls:"srs-counts"}), homepage = content.createDiv(), front = content.createDiv({cls:"srs-front"}), back = content.createDiv({cls:"srs-back"});
    const actions = host.createDiv({cls:"srs-actions"}), source = content.createDiv({cls:"srs-source"});
    function sizeReviewer(){
      const top=Math.max(0,host.getBoundingClientRect?.().top??0);
      host.style?.setProperty("--srs-top",`${top}px`);
    }
    globalThis.addEventListener?.("resize",sizeReviewer);
    globalThis.visualViewport?.addEventListener("resize",sizeReviewer);
    component.register(()=>{globalThis.removeEventListener?.("resize",sizeReviewer);globalThis.visualViewport?.removeEventListener("resize",sizeReviewer);});
    const dirty = new Set(), cache = new Map(), skipped = new Set();
    let taxonomy;
    const contentCache=new Map(), metadataCache=new Map(), metrics=[];
    const counters={fileReads:0,sourceReads:0,renders:0,indexSyncs:0,schedulingBuilds:0,cardPreparations:0};
    let hydrationKey, statesSnapshot, statesRevision;
    const profileCache=new Map();
    let runtimeCache, snapshotCache, runtimeDirty=true, indexDirty=true, catalogDirty=true;
    let operation=0, checking=false, membershipCache=new Map();
    let schedulingIndex, runtimeCards, runtimeSources, runtimeSnapshot;
    const runtimePositions=new Map(), knownErrors=new Map();
    let runtimeLoaded, runtimeBase;
    let knownCardIds, reviewFiles;
    const clock=()=>globalThis.performance?.now?.()??Date.now();
    async function measure(name,fn){const start=clock();try{return await fn();}finally{metrics.push({name,ms:Math.round((clock()-start)*100)/100});if(metrics.length>60)metrics.shift();}}
    const performanceButton=toolBody.createEl("button",{text:"Performance details"});
    performanceButton.onclick=()=>{notice.textContent=JSON.stringify({...counters,scheduling:schedulingIndex?.stats})+" · "+metrics.map(x=>`${x.name}: ${x.ms}ms`).join(" · ");};
    const checkButton=toolBody.createEl("button",{text:"Check content"});
    const cancelCheck=toolBody.createEl("button",{text:"Cancel content check"});
    cancelCheck.onclick=()=>{operation++;checking=false;notice.textContent="Content check cancelled; completed results retained.";};
    function resetQueues(){membershipCache.clear();profileCache.clear();schedulingIndex=null;runtimeCards=null;}
    function deckMatches(card,id){return membershipCache.get(id)?.has(card.id)??studyDeckMatches(card,id,studyConfig,manifest);}
    function inScope(card,deck=selectedDeck){return !card.retired && (!select.value||card.group===select.value) && (!deck || (studyConfig?deckMatches(card,deck):manifest.scheduling.decks[card.deck_id]?.name===manifest.scheduling.decks[deck]?.name||manifest.scheduling.decks[card.deck_id]?.name.startsWith(manifest.scheduling.decks[deck]?.name+"::")));}
    async function rendered(card){
      if(contentCache.has(card.id))return {...card,...contentCache.get(card.id),card_settings:card.card_settings};
      counters.renders++;const generation=sourceGeneration,key=configKey;
      let result;try{result={...await resolveSource({...card}),validation:"valid"};}catch(e){result={...card,content_error:e.message,validation:"error"};}
      if(generation===sourceGeneration&&key===configKey&&!disposed){contentCache.set(card.id,result);
        if(runtimeCards){const position=runtimePositions.get(card.id);if(position!==undefined)runtimeCards[position]=result;if(result.content_error)knownErrors.set(card.id,result);else knownErrors.delete(card.id);}
        schedulingIndex?.update(result);}
      return result;
    }
    async function checkContent(deck=selectedDeck){
      if(checking||busy||managerDirty)return;
      checking=true;const token=++operation;
      try{const all=(await readSources()).filter(c=>inScope(c,deck));
        for(let i=0;i<all.length;i++){
          if(disposed||token!==operation)return;
          await rendered(all[i]);
          if(i%25===0){notice.textContent=`Checking content: ${i+1}/${all.length}`;await new Promise(resolve=>setTimeout(resolve,0));}
        }
      }catch(e){message(e);}finally{if(token===operation){checking=false;await guardedDraw();}}
    }
    checkButton.onclick=()=>checkContent(managing?managerDeck:selectedDeck);

    let resolvedCards, resolvedConfig, sourceGeneration = 0, resolvedGeneration = -1;
    const candidateSources = new Map();
    let manifest, baseManifest, studyConfig, studyKey, panel="", cards = [], config, index, states, shown, configKey, started = 0;
    let rawCards=[], noteBindings=[], studyParts=null;
    let timeKey="", nextWake=Infinity;
    let busy = false, disposed = false, refreshTimer, pending = false, selectedDeck = null;
    let reviewing = Boolean(input?.group), activeGroup=input?.group||"";
    const positionKey=`${identity}:position:${input?.group||""}`;
    try {
      const saved=JSON.parse(localStorage.getItem(positionKey)||"null");
      if(saved&&typeof saved.reviewing==="boolean"){
        reviewing=saved.reviewing;
        selectedDeck=typeof saved.deck==="string"?saved.deck:null;
        activeGroup=typeof saved.group==="string"?saved.group:activeGroup;
      }
    }catch{}
    function savePosition(){
      try{localStorage.setItem(positionKey,JSON.stringify({reviewing,deck:selectedDeck,group:activeGroup}));}catch{}
    }
    let deckQuery="", expandedDecks=new Set(), editingDeckId=null;
    let managing=false, managerQuery="", managerStatus="all", managerDeck="", editedCardId=null, managerDirty=false;
    let deviceId = input?.device || localStorage.getItem(`${identity}:device-name`);
    if (!["computer","android"].includes(deviceId))deviceId=/Android/i.test(globalThis.navigator?.userAgent||"")?"android":"computer";
    for(const name of ["computer","android"])deviceSelect.createEl("option",{value:name,text:`Device: ${name}`});
    deviceSelect.value=deviceId;
    localStorage.setItem(`${identity}:device-name`,deviceId);
    deviceSelect.onchange=()=>{deviceId=deviceSelect.value;localStorage.setItem(`${identity}:device-name`,deviceId);};
    component.register(() => {disposed=true;operation++;clearTimeout(refreshTimer);index?.close();});
    const store = {
      async list(directory) {return directory===`${dataRoot}/reviews`?[...reviewFileMap().values()]:api.vault.getFiles().filter(f=>f.path.startsWith(directory+"/"));},
      async read(path) {counters.fileReads++;const f=api.vault.getAbstractFileByPath(path);return f ? api.vault.read(f) : null;},
      async create(path,text) {await api.vault.create(path,text);},
      async mkdir(path) {if(!api.vault.getAbstractFileByPath(path))try{await api.vault.createFolder(path);}catch(error){if(!api.vault.getAbstractFileByPath(path))throw error;}},
      async append(path,text) {const f=api.vault.getAbstractFileByPath(path);if(!f)throw Error(`Missing log: ${path}`);await api.vault.append(f,text);}
    };
    async function json(path) {const text=await store.read(path);if(text===null)throw Error(`Missing SRS file: ${path}`);return JSON.parse(text);}
    async function cachedConfiguration(){if(!runtimeCache||runtimeDirty){runtimeCache=await measure("Configuration",runtimeConfiguration);runtimeDirty=false;}return runtimeCache;}
    async function runtimeConfiguration(){
      if(await store.read(`${dataRoot}/catalog.pending.json`)!==null)throw Error("Catalog update in progress; rerun discovery if it was interrupted.");
      if(await store.read(`${root}/config/sources.json`)!==null){
        const parts={};
        await Promise.all(Object.entries({sources:"config/sources.json",cards:"config/cards.json",decks:"config/decks.json",assignments:"config/profile-rules.json",profiles:"data/profiles.json"}).map(async([key,path])=>{parts[key]=await json(`${root}/${path}`);}));
        return {study:composeStudyDocuments(parts),templates:parts.cards,parts};
      }
      const text=await store.read(`${root}/study.json`);
      return {study:text===null?null:validateStudy(JSON.parse(text)),templates:await json(`${root}/config.json`),parts:null};
    }
    function message(e) {notice.textContent=String(e.message||e);}
    function clearCard() {context.empty();front.empty();back.empty();actions.empty();source.empty();homepage.empty();shown=null;}
    function reviewFileMap(){
      if(!reviewFiles)reviewFiles=new Map(api.vault.getFiles().filter(f=>f.path.startsWith(`${dataRoot}/reviews/`)&&LOG_PATTERN.test(f.path.split("/").at(-1))).map(f=>[f.path,f]));
      return reviewFiles;
    }
    function logFiles(){return [...reviewFileMap().values()].map(f=>({path:f.path,stat:f.stat?{...f.stat}:undefined}));}
    async function syncIndex() {
      counters.indexSyncs++;
      const force=new Set([...dirty].filter(p=>p.startsWith(`${dataRoot}/reviews/`)));
      const changes=[];
      const result=await index.sync(logFiles(),async f=>{const t=await store.read(f.path);if(t===null)throw Error(`Log disappeared: ${f.path}`);return t;},knownCardIds,{
        force, readSchedulerConfig:id=>store.read(`${dataRoot}/scheduler-configs/${id}.json`),
        onEvents:snapshotCache?batch=>changes.push(...batch):undefined,
        progress:n=>{if(!disposed && n>=500)notice.textContent=`Indexing reviews: ${n.toLocaleString()}…`;}
      });
      for(const path of force)dirty.delete(path);
      if(snapshotCache){
        if(result.rebuilt||changes.some(e=>e.kind==='card_settings')){snapshotCache=null;runtimeCards=null;schedulingIndex=null;indexDirty=true;}
        else {
          snapshotCache.activityIds??=new Set(snapshotCache.activity.map(e=>e.id));
          const touched=new Set();
          for(const event of changes){
            if(event.kind==='historical_review'||event.kind==='scheduling_baseline')continue;
            touched.add(event.card_id);
            if(!snapshotCache.activityIds.has(event.id)&&studyDay(event.review_time_ms,manifest.timing)===studyDay(Date.now(),manifest.timing)){
              snapshotCache.activityIds.add(event.id);snapshotCache.activity.push(event);schedulingIndex?.addActivity(event);
            }
          }
          for(const id of touched){
            const latest=await index.get("latest",id);snapshotCache.latest.set(id,latest);
            const card=runtimeCards?.[runtimePositions.get(id)];
            if(card){const value=current(card,states.get(id)?.state,latest);states.set(id,value);schedulingIndex?.update(card,value);}
          }
          indexDirty=false;
        }
      }
      return result;
    }
    async function noteAt(file) {
      let stored=cache.get(file.path);
      if(!stored || !file.stat || stored.mtime!==file.stat.mtime || stored.size!==file.stat.size || dirty.has(file.path)) {
        counters.sourceReads++;
        const text=await api.vault.read(file);
        if(file.path.endsWith(".csv")) stored={rows:indexRows(parseCSV(text))};
        else {
          // Obsidian owns YAML parsing on both supported platforms.
          const metadata=api.metadataCache.getFileCache(file)?.frontmatter || {};
          stored={metadata,body:text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,""),text};
        }
        Object.assign(stored,{mtime:file.stat?.mtime,size:file.stat?.size});cache.set(file.path,stored);dirty.delete(file.path);
      }
      return stored;
    }
    async function resolveSource(card,metadataOnly=false) {
      if(!card.template)throw Error("No editable template mapped to this Anki card ordinal");
      if(!card.template.enabled)throw Error("Template disabled in config/cards.json");
      if(!card.source)throw Error("Unresolved vault source");
      if(card.source.error)throw Error(card.source.error);
      let path=card.source.path;
      if(!path && card.source.candidates) {
        const key=canonical(card.source.candidates);
        if(!candidateSources.has(key)) {
          const identities=new Map();
          for(const file of api.vault.getFiles().filter(f=>card.source.candidates.some(p=>f.path===p||f.path.startsWith(p+"/")))) {
            const note=await noteAt(file);
            const uids=note.rows ? note.rows.keys() : [note.metadata?.anki_note_id ? `anki:${note.metadata.anki_note_id}` : `local:${(note.metadata?.srs_note_id || note.metadata?.srs_uid)}`];
            for(const uid of uids) {
              if(!identities.has(uid))identities.set(uid,[]);
              identities.get(uid).push(file.path);
            }
          }
          candidateSources.set(key,identities);
        }
        const matches=candidateSources.get(key).get(card.note_uid)||[];
        if(matches.length!==1)throw Error(matches.length?"Duplicate vault source identity":"Unresolved vault source");
        path=matches[0];
      }
      const file=api.vault.getAbstractFileByPath(path);
      if(!file)throw Error(`Missing vault source: ${path}`);
      const data=await noteAt(file);
      let metadata=data.rows?data.rows.get(card.note_uid):data.metadata;
      if(card.source.prepare==="prepare_taxonomy_notes") {
        if(!taxonomy) {
          const notes=[];
          for(const f of api.vault.getFiles().filter(f=>f.path.startsWith("wiki/life/")&&f.path.endsWith(".md"))) {
            const parsed=await noteAt(f);
            if(Object.keys(parsed.metadata).length)notes.push({path:f.path,filename:f.basename||f.path.split("/").at(-1).replace(/\.md$/,""),metadata:parsed.metadata});
          }
          taxonomy=prepareTaxonomy(notes);
        }
        metadata=taxonomy.get(path)||metadata;
      }
      if(card.source.kind==="block") {
        const matches=(data.blocks??=sourceBlocks(data.text)).filter(block=>block.identity===card.note_uid);
        if(matches.length!==1)throw Error(matches.length?"Duplicate block identity":"Missing Markdown block identity");
        metadata={...metadata,$front:matches[0].front,$back:matches[0].back,tags:[...new Set([...(Array.isArray(metadata.tags)?metadata.tags:String(metadata.tags||"").split(/\s+/).filter(Boolean)),...matches[0].tags])]};
      }
      if(!metadata)throw Error(`Missing source identity: ${card.note_uid}`);
      if(card.source.kind!=="block" && !data.rows && (metadata.anki_note_id || metadata.srs_note_id || metadata.srs_uid)) {
        const uid=metadata.anki_note_id?`anki:${metadata.anki_note_id}`:`local:${metadata.srs_note_id || metadata.srs_uid}`;
        if(uid!==card.note_uid)throw Error("Source identity changed");
      }
      const note={metadata,body:data.body,filename:file.basename||file.path.split("/").at(-1).replace(/\.md$/,""),path,lookups:{us_states:US_STATES}};
      card.properties=metadata;
      card.source_tags=Array.isArray(metadata.tags)?metadata.tags:String(metadata.tags||"").split(/\s+/).filter(Boolean);
      if(metadataOnly)return {...card,source:{...card.source,path},validation:"unchecked"};
      const fields=fieldsFromNote(card,note);
      const special={...fields,Deck:manifest.scheduling?.decks[card.deck_id]?.name||"",Subdeck:manifest.scheduling?.decks[card.deck_id]?.name.split("::").at(-1)||"",Card:card.template.key,Type:card.anki_notetype,Tags:Array.isArray(metadata.tags)?metadata.tags.join(" "):String(metadata.tags||"")};
      const images=text=>resolveImageEmbeds(text,path,
        (target,source)=>api.metadataCache.getFirstLinkpathDest(target,source),
        file=>api.vault.getResourcePath(file));
      const frontText=images(renderV2(card.template.front,special,card.anki_ordinal,false));
      const backText=images(renderV2(card.template.back,{...special,FrontSide:frontText},card.anki_ordinal,true));
      if(!frontText.trim() || !backText.trim())throw Error("Template produced an empty question or answer");
      return {...card,source:{...card.source,path},fields,frontText,backText};
    }
    async function readSources() {
      if(resolvedCards && resolvedConfig===configKey && resolvedGeneration===sourceGeneration)return resolvedCards;
      const generation=sourceGeneration;

      const result=[];
      const needsMetadata=/"(?:tags|properties)"/.test(JSON.stringify({decks:studyConfig?.decks,rules:studyConfig?.profile_rules}));
      for(const configured of configuredCards(cards,config)) {
        const rule=studyConfig?.source_rules[configured.group];
        const card=rule && configured.source ? {...configured,source:{...configured.source,fields:rule.fields,prepare:rule.prepare||null}}:configured;
        try {
          if(needsMetadata&&!card.retired){if(!metadataCache.has(card.id))metadataCache.set(card.id,await resolveSource({...card},true));result.push(metadataCache.get(card.id));}
          else result.push({...card,validation:"unchecked"});
        }
        catch(e) {result.push({...card,content_error:e.message});}
      }
      resolvedCards=result;resolvedConfig=configKey;resolvedGeneration=generation;
      return result;
    }
    function current(card,baseline,latest) {return latest?{state:latest.state,parent:latest.id}:{state:baseline,parent:`import:${manifest.import_id}:${card.id}`};}
    async function baseline(card) {
      if(card.baseline)return card.baseline;
      const options=effectiveSettings(card,manifest);
      const key=`${card.id}:${await hash(canonical(options))}`;
      let state=await index.get("baselines",key);
      if(!state) {
        const history=card.history || (card.history_path ? (await json(`${dataRoot}/${card.history_path}`))[card.id] : await index.historyFor(card.id));
        state=initialState({...card,history},schedulerV2(options));
        if(card.scheduling)Object.assign(state,{reps:card.scheduling.reps,lapses:card.scheduling.lapses,
          scheduled_days:card.scheduling.ivl,queue:card.queue,anki_due:card.anki_due,
          learning_steps:Math.max(0,(card.card_type===3?options.relearning_steps:options.learning_steps).length-card.scheduling.left%1000)});
        await index.put("baselines",key,state);
      }
      return state;
    }
    function showCounts(el,n) {
      el.createEl("span",{text:`${n.new ?? n.fresh ?? 0} new`,cls:"srs-new"});
      el.createEl("span",{text:` · ${n.learning||0} learning`,cls:"srs-learning"});
      el.createEl("span",{text:` · ${n.review||0} review`,cls:"srs-review"});
      if(n.errors)el.createEl("span",{text:` · ${n.errors} content errors`,cls:"srs-errors"});
    }
    function contentProblems(available) {
      return [...knownErrors.values()].filter(c=>c.content_error && (!select.value || c.group===select.value) &&
        (studyConfig ? !selectedDeck || deckMatches(c,selectedDeck) : !selectedDeck || manifest.scheduling.decks[c.deck_id]?.name===manifest.scheduling.decks[selectedDeck]?.name ||
          manifest.scheduling.decks[c.deck_id]?.name.startsWith(manifest.scheduling.decks[selectedDeck]?.name+"::")));
    }
    function showErrors(available) {
      const count=schedulingIndex?.counts(selectedDeck,select.value).errors??contentProblems(available).length;
      if(!count)return;
      let problems;
      const details=homepage.createEl("details");details.createEl("summary",{text:`Inspect ${count} content errors`});
      let offset=0,more;
      const page=()=>{
        problems??=contentProblems(available);
        if(more)more.disabled=true;
        for(const card of problems.slice(offset,offset+50)) {
          const row=details.createDiv();row.createEl("p",{text:`${card.anki_notetype||"Card"} · ${card.note_uid||card.id}: ${card.content_error}`});
          if(card.source?.path)row.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
        }
        offset+=50;if(offset<problems.length){more=details.createEl("button",{text:"Show more errors"});more.onclick=page;}
      };
      details.ontoggle=()=>{if(details.open && offset===0)page();};
    }
    function openCardSettings(card) {
      if(!leaveEditor())return;
      panel="";managing=true;editedCardId=card.id;managerDirty=false;guardedDraw();
    }
    function leaveEditor() {
      if(managerDirty){notice.textContent="You have unsaved changes. Save them or use the discard/close action before navigating.";return false;}
      return true;
    }
    function showDecks(queue,available) {
      homepage.createEl("h2",{text:"Decks"});
      homepage.createEl("p",{text:"Choose a deck to study, or browse its cards. Counts include subdecks.",cls:"srs-muted"});
      const filters=homepage.createDiv({cls:"srs-deck-filters"});
      const search=filters.createEl("input",{type:"search",value:deckQuery,attr:{placeholder:"Find a deck…","aria-label":"Find a deck"}});
      const expand=filters.createEl("button",{text:"Expand all"}),collapse=filters.createEl("button",{text:"Collapse all"});
      if(studyConfig)filters.createEl("button",{text:"New deck"}).onclick=()=>{editingDeckId=null;panel="deck";guardedDraw();};
      const list=homepage.createDiv({cls:"srs-deck-list"});
      function render() {
        list.empty();const query=deckQuery.trim().toLocaleLowerCase();
        const matches=node=>node.name.toLocaleLowerCase().includes(query)||node.children.some(matches);
        const build=(nodes,container)=>{for(const n of nodes) {
          if(query && !matches(n))continue;
          const details=container.createEl("details",{cls:"srs-deck"});
          details.open=Boolean(query)||expandedDecks.has(n.id);
          details.ontoggle=()=>{if(query)return;if(details.open)expandedDecks.add(n.id);else expandedDecks.delete(n.id);};
          const summary=details.createEl("summary",{attr:{"aria-label":n.name}});
          summary.createEl("span",{text:n.name.split("::").at(-1),cls:"srs-deck-name"});
          const badges=summary.createDiv({cls:"srs-deck-counts"});showCounts(badges,n);
          const buttons=summary.createDiv({cls:"srs-deck-actions"});
          buttons.createEl("button",{text:"Review",attr:{"aria-label":`Review ${n.name}`}}).onclick=e=>{e.preventDefault();selectedDeck=n.id;reviewing=true;guardedDraw();};
          buttons.createEl("button",{text:"Browse cards",attr:{"aria-label":`Browse cards in ${n.name}`}}).onclick=e=>{
            e.preventDefault();managerDeck=n.id;managerQuery="";managerStatus="all";editedCardId=null;managing=true;guardedDraw();
          };
          if(studyConfig)buttons.createEl("button",{text:"Edit",attr:{"aria-label":`Edit deck ${n.name}`}}).onclick=e=>{e.preventDefault();editingDeckId=n.id;panel="deck";guardedDraw();};
          const children=details.createDiv({cls:"srs-subdecks"});build(n.children,children);
          if(!n.children.length)details.open=false;
        }};build(queue.tree,list);
        if(!list.children.length)list.createEl("p",{text:"No decks match. Try another name.",cls:"srs-empty"});
      }
      search.oninput=()=>{deckQuery=search.value;render();};
      expand.onclick=()=>{const add=nodes=>{for(const n of nodes){expandedDecks.add(n.id);add(n.children);}};add(queue.tree);render();};
      collapse.onclick=()=>{expandedDecks.clear();deckQuery="";search.value="";render();};
      render();showErrors(available);
    }
    function showCardManager(available) {
      homepage.createEl("h3",{text:"Cards"});
      const filters=homepage.createDiv({cls:"srs-card-filters"});
      const search=filters.createEl("input",{type:"search",value:managerQuery,attr:{placeholder:"Search cards, sources, templates, or tags","aria-label":"Search cards"}});
      const status=filters.createEl("select",{attr:{"aria-label":"Card status"}});
      for(const [value,text] of [["all","All cards"],["active","Active cards"],["suspended","Suspended cards"],["errors","Content errors"]])status.createEl("option",{value,text});
      status.value=managerStatus;
      const deck=filters.createEl("select",{attr:{"aria-label":"Card deck"}});
      deck.createEl("option",{value:"",text:"All decks"});
      for(const [id,d] of Object.entries(studyConfig?.decks||manifest.scheduling?.decks||{}).sort(([,a],[,b])=>a.name.localeCompare(b.name)))deck.createEl("option",{value:id,text:d.name});
      deck.value=managerDeck;
      const summary=homepage.createDiv({cls:"srs-card-summary",attr:{role:"status","aria-live":"polite"}});
      const browser=homepage.createDiv({cls:"srs-card-browser"});
      const list=browser.createDiv({cls:"srs-card-list"}), editor=browser.createDiv({cls:"srs-card-editor"});
      const emptyEditor=()=>{editor.empty();editor.createEl("p",{text:"Select a card to preview its question and answer, suspend it, or edit its tags.",cls:"srs-empty"});};
      emptyEditor();
      const entries=available.map(card=>({card,text:[card.id,card.note_uid,card.anki_notetype,card.template_key,card.source?.path,...(card.source?.candidates||[]),
        manifest.scheduling?.decks[card.deck_id]?.name,card.frontText,card.backText,card.content_error,...(card.card_settings?.tags||[])].join(" ").toLocaleLowerCase()}));
      const searchContent=homepage.createEl("button",{text:"Search card content"});
      searchContent.onclick=()=>checkContent(managerDeck);
      const unchecked=available.filter(c=>inScope(c,managerDeck)&&!contentCache.has(c.id)).length;
      if(unchecked)homepage.createEl("p",{text:`${unchecked} unchecked cards; content search and error results are incomplete until you check content.`,cls:"srs-muted"});
      const rowButtons=new Map();
      const label=card=>(card.frontText||card.note_uid||card.id).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,140);
      async function edit(card) {
        const token=operation;editedCardId=card.id;card=await rendered(card);if(disposed||token!==operation||editedCardId!==card.id)return;
        if(!leaveEditor())return;
        for(const [id,button] of rowButtons)button.setAttribute("aria-pressed",String(id===card.id));
        editedCardId=card.id;managerDirty=false;editor.empty();
        editor.createEl("h4",{text:label(card)});
        editor.createEl("p",{text:manifest.scheduling?.decks[card.deck_id]?.name||card.group||"",cls:"srs-muted"});
        if(!card.content_error) {
          const preview=editor.createDiv({cls:"srs-card-preview"});
          preview.createEl("h5",{text:"Question"});dv.el("div",card.frontText,{container:preview});
          preview.createEl("h5",{text:"Answer"});dv.el("div",card.backText,{container:preview});
        }
        const metadata=editor.createEl("details",{cls:"srs-card-metadata"});
        metadata.createEl("summary",{text:"Card details"});
        metadata.createEl("p",{text:`${card.anki_notetype||"Card"} · ${card.template_key||`ordinal ${card.anki_ordinal}`}`});
        metadata.createEl("p",{text:`Card ID: ${card.id}`});
        if(card.source?.path)editor.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
        if(card.content_error)editor.createEl("p",{text:card.content_error,cls:"srs-errors"});
        const suspension=editor.createEl("label",{text:"Suspended "});
        const suspended=suspension.createEl("input",{type:"checkbox"});
        const originalSuspended=cardSuspended(card,states.get(card.id));suspended.checked=originalSuspended;
        const tagLabel=editor.createEl("label",{text:"Card tags (comma-separated)"});
        const tags=tagLabel.createEl("input",{type:"text",value:(card.card_settings?.tags||[]).join(", ")});
        let profileSelect;
        if(studyConfig){
          const profileLabel=editor.createEl("label",{text:"Scheduling profile"});
          profileSelect=profileLabel.createEl("select",{attr:{"aria-label":"Card scheduling profile"}});
          profileSelect.createEl("option",{value:"",text:`Automatic (${studyConfig.profiles[studyProfileId({...card,card_settings:{...card.card_settings,profile:null}},studyConfig,manifest)].name})`});
          for(const [id,p] of Object.entries(studyConfig.profiles))profileSelect.createEl("option",{value:id,text:p.name||id});
          profileSelect.value=card.card_settings?.profile||"";
        }
        const changed=editor.createDiv({cls:"srs-muted",attr:{role:"status"}});
        suspended.onchange=tags.oninput=()=>{managerDirty=true;changed.textContent="Unsaved changes";};
        if(profileSelect)profileSelect.onchange=()=>{managerDirty=true;changed.textContent="Unsaved changes";};
        const buttons=editor.createDiv();
        buttons.createEl("button",{text:"Save card settings",cls:"mod-cta"}).onclick=()=>{
          const changes={}, nextTags=[...new Set(tags.value.split(",").map(t=>t.trim()).filter(Boolean))];
          if(profileSelect && profileSelect.value!==(card.card_settings?.profile||""))changes.profile=profileSelect.value||null;
          if(suspended.checked!==originalSuspended)changes.suspended=suspended.checked;
          if(canonical(nextTags)!==canonical(card.card_settings?.tags||[]))changes.tags=nextTags;
          return saveCardSettings(card,changes);
        };
        buttons.createEl("button",{text:"Use imported defaults"}).onclick=()=>saveCardSettings(card,{suspended:null,tags:null,...(studyConfig?{profile:null}:{})});
        buttons.createEl("button",{text:"Close settings"}).onclick=()=>{emptyEditor();editedCardId=null;managerDirty=false;for(const button of rowButtons.values())button.setAttribute("aria-pressed","false");};
      }
      function renderList() {
        list.empty();rowButtons.clear();
        const terms=managerQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const deckName=manifest.scheduling?.decks[managerDeck]?.name;
        const matches=entries.filter(({card,text})=>!card.retired && terms.every(term=>text.includes(term)) &&
          (managerStatus==="all" || (managerStatus==="errors" ? Boolean(card.content_error) : cardSuspended(card,states.get(card.id))===(managerStatus==="suspended"))) &&
          (studyConfig ? !managerDeck || deckMatches(card,managerDeck) : !deckName || manifest.scheduling.decks[card.deck_id]?.name===deckName || manifest.scheduling.decks[card.deck_id]?.name.startsWith(deckName+"::")));
        summary.textContent=`${matches.length.toLocaleString()} matching cards`;
        if(!matches.length)list.createEl("p",{text:"No cards match these filters. Try a different search or deck.",cls:"srs-empty"});
        let offset=0, more;
        const page=()=>{
          if(more)more.remove();
          for(const {card} of matches.slice(offset,offset+50)) {
            const row=list.createDiv({cls:"srs-card-row"});
            const button=row.createEl("button",{text:label(card),attr:{"aria-label":`Edit ${label(card)}`,"aria-pressed":String(editedCardId===card.id)}});
            rowButtons.set(card.id,button);button.onclick=()=>edit(card);
            if(card.content_error)row.createEl("small",{text:"Content error",cls:"srs-error-badge"});
            row.createEl("span",{text:`${cardSuspended(card,states.get(card.id))?"Suspended":"Active"} · ${card.template_key||card.anki_ordinal} · ${manifest.scheduling?.decks[card.deck_id]?.name||""}${card.card_settings?.tags?.length?" · "+card.card_settings.tags.join(", "):""}`});
          }
          offset+=50;
          if(offset<matches.length){more=list.createEl("button",{text:"Show more cards"});more.onclick=page;}
        };page();
      }
      search.oninput=()=>{managerQuery=search.value;renderList();};
      status.onchange=()=>{managerStatus=status.value;renderList();};
      deck.onchange=()=>{managerDeck=deck.value;renderList();};
      renderList();
      const selected=available.find(card=>card.id===editedCardId);if(selected)edit(selected);
    }
    function showConfiguration(section){
      if(section==="deck"){showDeckEditor();return;}
      homepage.createEl("h2",{text:section==="profiles"?"Scheduling profiles":"Sources"});
      if(!studyConfig){homepage.createEl("p",{text:"Create the study configuration once from migration/: uv run python migrate.py init-study"});return;}
      homepage.createEl("button",{text:panel==="profiles"?"Open scheduling profiles":"Open source rules"}).onclick=()=>api.workspace.openLinkText(`${root}/${studyParts?(panel==="profiles"?"data/profiles.json":"config/sources.json"):"study.json"}`,"",false);
      if(section==="sources"){
        homepage.createEl("p",{text:"Rules create cards from your vault content. Templates define the questions; study decks select which cards to practice."});
        homepage.createEl("p",{text:"Discover additions on desktop from tools/: uv run python srs.py refresh-cards. Then Refresh here to load them. This preserves existing schedules and review logs."});
        for(const [id,rule] of Object.entries(studyConfig.source_rules)){
          const row=homepage.createDiv({cls:"srs-card-editor"});row.createEl("h3",{text:id});
          row.createEl("p",{text:rule.sources.join(", ")});row.createEl("p",{text:`Templates: ${rule.templates.join(", ")}`});
          row.createEl("p",{text:`New cards use: ${studyConfig.profiles[rule.profile].name||rule.profile}`});
        }return;
      }
      homepage.createEl("p",{text:"Changes apply to future answers. Current memory states and due dates are preserved. Imported deck limits and daily counters remain in force."});
      const profileForms=[];
      for(const [id,profile] of Object.entries(studyConfig.profiles)){
        const row=homepage.createEl("details",{cls:"srs-profile"});row.createEl("summary",{text:profile.name||id});
        row.createEl("p",{text:`Train on desktop from tools/: uv run python srs.py train --profile ${id} --apply`});
        const fields={};profileForms.push(row);
        for(const [key,label,value,type] of [["name","Name",profile.name,"text"],["desired_retention","Desired retention (0–1)",profile.settings.desired_retention,"number"],
          ["new_cards_per_day","New cards per day",profile.settings.new_cards_per_day,"number"],["reviews_per_day","Reviews per day",profile.reviews_per_day,"number"],
          ["learning_steps","Learning steps in minutes",profile.settings.learning_steps.join(", "),"text"],["relearning_steps","Relearning steps in minutes",profile.settings.relearning_steps.join(", "),"text"]]){
          const labelEl=row.createEl("label",{text:label});fields[key]=labelEl.createEl("input",{type,value:String(value),attr:{"aria-label":`${profile.name||id}: ${label}`}});
          fields[key].oninput=()=>{managerDirty=true;for(const other of profileForms)if(other!==row){other.querySelectorAll("input").forEach(e=>e.disabled=true);other.querySelectorAll("button").forEach(e=>e.disabled=true);}notice.textContent="Unsaved profile changes. Save or discard before navigating.";};
        }
        const weights=row.createEl("details");weights.createEl("summary",{text:`${profile.settings.weights.length} FSRS parameters`});weights.createEl("pre",{text:JSON.stringify(profile.settings.weights)});
        row.createEl("button",{text:"Save profile",cls:"mod-cta"}).onclick=async()=>{
          if(busy)return;busy=true;
          try{
            const replacement=JSON.parse(JSON.stringify(studyConfig)),next=replacement.profiles[id];
            next.name=fields.name.value.trim()||id;next.reviews_per_day=Number(fields.reviews_per_day.value);
            for(const key of ["desired_retention","new_cards_per_day"])next.settings[key]=Number(fields[key].value);
            for(const key of ["learning_steps","relearning_steps"])next.settings[key]=fields[key].value.trim()?fields[key].value.split(",").map(x=>Number(x.trim())):[];
            validateStudy(replacement);
            await commitStudy(replacement);
            managerDirty=false;await draw();notice.textContent="Profile saved. Existing due dates are preserved.";
          }catch(e){message(e);}finally{busy=false;}
        };
        row.createEl("button",{text:"Discard profile changes"}).onclick=()=>{managerDirty=false;guardedDraw();};
      }
    }
    async function commitStudy(replacement){
      validateStudy(replacement);
      await withStoreLock(identity,async()=>{
        const latest=await runtimeConfiguration();
        if(canonical(latest.study)!==studyKey)throw Error("Study configuration changed; discard changes, Refresh and retry");
        let path=`${root}/study.json`,before=studyConfig,after=replacement;
        if(studyParts){
          const changed=[];
          if(canonical(replacement.profiles)!==canonical(studyConfig.profiles)||replacement.default_profile!==studyConfig.default_profile)
            changed.push({path:`${dataRoot}/profiles.json`,before:studyParts.profiles,after:{format_version:1,profiles:replacement.profiles,default_profile:replacement.default_profile}});
          if(canonical(replacement.decks)!==canonical(studyConfig.decks))
            changed.push({path:`${root}/config/decks.json`,before:studyParts.decks,after:{format_version:1,decks:replacement.decks}});
          if(canonical(replacement.source_rules)!==canonical(studyConfig.source_rules)||canonical(replacement.profile_rules)!==canonical(studyConfig.profile_rules))throw Error("Edit source and assignment rules in config/");
          if(!changed.length)return;if(changed.length!==1)throw Error("Save one configuration document at a time");
          ({path,before,after}=changed[0]);
        }
        const file=api.vault.getAbstractFileByPath(path);
        const update=text=>{if(canonical(JSON.parse(text))!==canonical(before))throw Error("Configuration changed; discard changes, Refresh and retry");return JSON.stringify(after,null,2)+"\n";};
        if(api.vault.process)await api.vault.process(file,update);
        else await api.vault.modify(file,update(await api.vault.read(file)));
        runtimeDirty=true;resetQueues();
      });
    }
    function showDeckEditor(){
      const previous=editingDeckId && studyConfig.decks[editingDeckId];
      homepage.createEl("h2",{text:previous?"Edit study deck":"New study deck"});
      homepage.createEl("p",{text:"A study deck selects existing cards. It does not create cards or change their schedules. Parent decks also include their children's selections."});
      const form=homepage.createDiv({cls:"srs-card-editor"});
      const name=form.createEl("label",{text:"Name"}).createEl("input",{type:"text",value:previous?.name||"",attr:{"aria-label":"Deck name"}});
      const parent=form.createEl("label",{text:"Parent deck"}).createEl("select",{attr:{"aria-label":"Parent deck"}});
      parent.createEl("option",{value:"",text:"None"});
      for(const [id,deck] of Object.entries(studyConfig.decks))if(id!==editingDeckId)parent.createEl("option",{value:id,text:deck.name});parent.value=previous?.parent_id||"";
      const mode=form.createEl("label",{text:"Select cards using"}).createEl("select",{attr:{"aria-label":"Deck filter mode"}});
      if(previous)mode.createEl("option",{value:"existing",text:"Keep existing filter"});mode.createEl("option",{value:"sources",text:"Source paths, templates and tags"});mode.value=previous?"existing":"sources";
      const inputs={};
      for(const [key,title,placeholder] of [["paths","Source paths","wiki/biology, data/words.csv"],["groups","Source rule names","example-notes"],["templates","Template keys","recognition"],["tags","Required tags","extra-practice"]]){
        const label=form.createEl("label",{text:title});inputs[key]=label.createEl("input",{type:"text",value:(previous?.filter[key]||[]).join(", "),attr:{placeholder,"aria-label":`Deck ${title.toLowerCase()}`}});
        inputs[key].disabled=mode.value==="existing";
      }
      form.createEl("p",{text:"Separate alternatives with commas. All listed tags are required. Blank fields match all cards. Choose source filters to replace the existing filter.",cls:"srs-muted"});
      for(const control of [name,parent,mode,...Object.values(inputs)]){
        const change=()=>{managerDirty=true;notice.textContent="Unsaved deck changes.";for(const field of Object.values(inputs))field.disabled=mode.value==="existing";};
        if(control===parent||control===mode)control.onchange=change;else control.oninput=change;
      }
      form.createEl("button",{text:"Save deck",cls:"mod-cta"}).onclick=async()=>{
        if(busy)return;busy=true;
        try{
          if(!name.value.trim())throw Error("Give the deck a name");
          const replacement=JSON.parse(JSON.stringify(studyConfig)),id=editingDeckId||name.value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||crypto.randomUUID();
          if(!editingDeckId && replacement.decks[id])throw Error("A deck with that ID already exists; choose another name");
          const filter=mode.value==="existing"?previous.filter:Object.fromEntries(Object.entries(inputs).map(([key,field])=>[key,field.value.split(",").map(x=>x.trim()).filter(Boolean)]).filter(([,values])=>values.length));
          replacement.decks[id]={name:name.value.trim(),parent_id:parent.value||null,filter};
          await commitStudy(replacement);managerDirty=false;panel="";reviewing=false;selectedDeck=null;await draw();notice.textContent="Study deck saved.";
        }catch(e){message(e);}finally{busy=false;}
      };
      form.createEl("button",{text:"Discard deck changes"}).onclick=()=>{managerDirty=false;panel="";guardedDraw();};
    }
    async function saveCardSettings(card,changes) {
      if(busy)return;
      if(!Object.keys(changes).length){managerDirty=false;notice.textContent="No settings changed.";return;}
      busy=true;homepage.querySelectorAll("button").forEach(button=>button.disabled=true);
      try {
        await withStoreLock(identity,async()=>{
          if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Catalog changed; reopen the view");
          await syncIndex();
          const event={format_version:2,kind:"card_settings",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,time_ms:Date.now(),changes};
          validateEvent(event,manifest.import_id);
          const logPath=await appendReview(store,`${dataRoot}/reviews`,event);
          reviewFileMap().set(logPath,api.vault.getAbstractFileByPath(logPath));
          dirty.add(logPath);await syncIndex();
        });
        managerDirty=false;await draw();notice.textContent="Card settings saved.";
      }catch(e){message(e);homepage.querySelectorAll("button").forEach(button=>button.disabled=false);}
      finally{busy=false;if(pending && !managerDirty){pending=false;scheduleRefresh();}}
    }
    async function draw() {
      if(disposed)return;
      clearCard();counts.empty();notice.textContent="";
      host.setAttribute("data-reviewing",String(reviewing&&!managing&&!panel));
      sizeReviewer();
      content.scrollTop=0;
      home.setAttribute("aria-pressed",String(!panel && !managing && !reviewing));
      profilesButton.setAttribute("aria-pressed",String(panel==="profiles"));
      sourcesButton.setAttribute("aria-pressed",String(panel==="sources"));
      manage.setAttribute("aria-pressed",String(managing));
      const freshManifest=catalogDirty?await json(`${dataRoot}/manifest.json`):baseManifest;
      if(freshManifest.import_id!==baseManifest.import_id)throw Error("Imported baseline changed; reopen this view");
      if(freshManifest.revision!==baseManifest.revision){await loadCatalog(freshManifest);resolvedCards=null;contentCache.clear();metadataCache.clear();resetQueues();}
      const loaded=await cachedConfiguration();
      if(runtimeLoaded!==loaded||runtimeBase!==baseManifest){
        studyConfig=loaded.study;studyParts=loaded.parts;studyKey=canonical(studyConfig);
        manifest=studyConfig?studyRuntimeManifest(baseManifest,studyConfig):baseManifest;
        config=loaded.templates;const nextConfigKey=canonical({templates:config,study:studyConfig});
        if(configKey!==nextConfigKey){contentCache.clear();metadataCache.clear();resolvedCards=null;resetQueues();operation++;}
        configKey=nextConfigKey;runtimeLoaded=loaded;runtimeBase=baseManifest;
      }
      catalogDirty=false;
      if(selectedDeck&&!(studyConfig?.decks[selectedDeck]||(!studyConfig&&manifest.scheduling?.decks[selectedDeck]))){selectedDeck=null;reviewing=false;}
      savePosition();
      const nextHydrationKey=baseManifest.revision+":"+configKey;
      if(hydrationKey!==nextHydrationKey){cards=baseManifest.note_partition_count===undefined?rawCards:hydrateCatalog(rawCards,noteBindings,studyConfig);hydrationKey=nextHydrationKey;}
      const today=dayNumber(Date.now(),manifest.timing);
      if(!snapshotCache||indexDirty||snapshotCache.today!==today){
        await measure("Review index",()=>withStoreLock(identity,async()=>{
          if(snapshotCache?.today!==today)snapshotCache=null;
          await syncIndex();
          if(!snapshotCache){snapshotCache={latest:await index.latest(),activity:await index.activityToday(Date.now()),settings:await index.cardSettings(),today};resetQueues();}
        }));
        indexDirty=false;
      }
      const snapshot=snapshotCache;
      const sources=await measure("Source metadata",readSources);
      if(!runtimeCards||runtimeSources!==sources||runtimeSnapshot!==snapshot){
        counters.cardPreparations++;
        runtimePositions.clear();knownErrors.clear();
        runtimeCards=await measure("Card index preparation",async()=>sources.map((card,i)=>{
          if(contentCache.has(card.id))card={...card,...contentCache.get(card.id)};
          const value={...card,card_settings:snapshot.settings.get(card.id)||{}};
          if(studyConfig){if(!profileCache.has(card.id)){try{studyProfileId(value,studyConfig,manifest);profileCache.set(card.id,null);}catch(e){profileCache.set(card.id,e.message);}}if(profileCache.get(card.id))value.content_error=profileCache.get(card.id);}
          runtimePositions.set(card.id,i);if(value.content_error)knownErrors.set(card.id,value);return value;
        }));
        runtimeSources=sources;runtimeSnapshot=snapshot;schedulingIndex=null;
      }
      const available=runtimeCards;
      if(statesSnapshot!==snapshot||statesRevision!==baseManifest.revision){states=new Map();
        for(const card of available) {
          const projection=card.baseline || {state:card.queue===0?State.New:card.card_type===3?State.Relearning:card.queue===2?State.Review:State.Learning,due:card.due_ms,queue:card.queue,anki_due:card.anki_due};
          states.set(card.id,current(card,projection,snapshot.latest.get(card.id)));
        }
        statesSnapshot=snapshot;statesRevision=baseManifest.revision;
      }
      if(manifest.scheduling&&studyConfig&&!membershipCache.size)membershipCache=await measure("Deck membership",()=>studyMemberships(available,studyConfig,manifest));
      const clockNow=Date.now();
      if(schedulingIndex&&!schedulingIndex.advance(clockNow))schedulingIndex=null;
      if(manifest.scheduling&&!schedulingIndex){counters.schedulingBuilds++;schedulingIndex=await measure("Scheduling index",()=>new SchedulingIndex(available,states,manifest,snapshot.activity,clockNow,studyConfig?membershipCache:null));for(const id of skipped)schedulingIndex.bury(id);}
      nextWake=schedulingIndex?.nextWake??Infinity;
      timeKey=String(schedulingIndex?.today??today);
      if(panel){showConfiguration(panel);return;}
      if(managing){showCardManager(available);return;}
      if(!reviewing && manifest.scheduling) {
        const queue={tree:await measure("Deck screen",()=>schedulingIndex.tree(select.value))};
        showDecks(queue,available);notice.textContent=`${cards.length.toLocaleString()} cards · ${knownErrors.size.toLocaleString()} known content errors · ${(schedulingIndex.counts().total-contentCache.size).toLocaleString()} unchecked`;
        return;
      }
      const queue=await measure("Selected queue",()=>schedulingIndex?schedulingIndex.queue(selectedDeck,select.value):reviewQueueV2(available,states,snapshot.activity,manifest,Date.now(),select.value));
      context.createEl("h2",{text:studyConfig?.decks[selectedDeck]?.name||manifest.scheduling?.decks[selectedDeck]?.name||select.value||"All decks"});
      context.createEl("button",{text:"Browse cards"}).onclick=()=>{managerDeck=selectedDeck||"";managerQuery="";managerStatus="all";editedCardId=null;managing=true;guardedDraw();};

      // Session skips do not change states, event logs, or the displayed counts.
      const renderGeneration=sourceGeneration;
      let card=queue.cards.find(c=>!skipped.has(c.id));
      if(card){card=await measure("Render selected card",()=>rendered(card));const i=runtimePositions.get(card.id);available[i]=card;}
      if(disposed||renderGeneration!==sourceGeneration){pending=true;return;}
      showCounts(counts,{...queue,errors:schedulingIndex?.counts(selectedDeck,select.value).errors??contentProblems(available).length});showErrors(available);
      if(!card){front.textContent="No cards ready for review in this session.";return;}
      shown=card;started=Date.now();
      context.createEl("h3",{cls:"srs-card-name",text:card.template?.name||`${card.anki_notetype||card.group||"Card"} · Card ${(card.anki_ordinal??0)+1}`});
      const skip=()=>{skipped.add(card.id);schedulingIndex?.bury(card.id);guardedDraw();};
      actions.createEl("button",{text:"Bury"}).onclick=skip;
      source.createEl("button",{text:"Card settings"}).onclick=()=>openCardSettings(card);
      if(card.source?.path)source.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
      if(card.content_error){front.textContent=card.content_error;actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      dv.el("div",card.frontText,{container:front});
      let options;
      try {options=effectiveSettings(card,manifest);schedulerV2(options);if(!snapshot.latest.has(card.id)){const value=current(card,await baseline(card));states.set(card.id,value);if(!card.baseline)schedulingIndex?.update(card,value);}}
      catch(e){message(e);actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      const reveal=actions.createEl("button",{text:"Show answer",cls:"mod-cta"});
      reveal.onclick=()=>{
        if(busy||shown!==card)return;
        try {
          dv.el("div",card.backText,{container:back});actions.empty();
          actions.createEl("button",{text:"Bury"}).onclick=skip;
          for(const [i,label]of["Again","Hard","Good","Easy"].entries()) {
            const preview=nextStateV2(card,states.get(card.id).state,options,manifest,Date.now(),i+1);
            const minutes=Math.max(0,Math.round((preview.due-Date.now())/60000));
            actions.createEl("button",{text:`${label} (${minutes<1440?minutes+"m":Math.round(minutes/1440)+"d"})`}).onclick=()=>answer(card,i+1);
          }
        }catch(e){message(e);actions.empty();actions.createEl("button",{text:"Bury"}).onclick=skip;}
      };
    }
    async function answer(card,rating) {
      if(busy||shown!==card||card.content_error)return;
      busy=true;actions.querySelectorAll("button").forEach(b=>b.disabled=true);
      try {
        const result=await withStoreLock(identity,async()=>{
          if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Catalog changed; reopen the view");
          const latestConfig=await runtimeConfiguration();
          if(canonical({templates:latestConfig.templates,study:latestConfig.study})!==configKey)return "Configuration changed. Queue refreshed.";
          await syncIndex();
          if(canonical(await index.cardSettingsFor(card.id))!==canonical(card.card_settings))return "Card settings changed. Queue refreshed.";
          const value=current(card,states.get(card.id).state,await index.get("latest",card.id));
          if(value.parent!==states.get(card.id).parent)return "Card reviewed on another device. Queue refreshed.";
          const live=await resolveSource(card);
          if(canonical(live.fields)!==canonical(card.fields))return "Source changed. Queue refreshed.";
          const now=Date.now(),options=effectiveSettings(card,manifest);
          const next=nextStateV2(card,value.state,options,manifest,now,rating);
          const schedulerConfigId=await saveSchedulerConfig(store,`${dataRoot}/scheduler-configs`,options);
          const event={format_version:2,kind:"answer",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,
            deck_id:card.original_deck_id||card.deck_id,...(studyConfig?{profile_id:studyProfileId(card,studyConfig,manifest)}:{}),import_id:manifest.import_id,parent:value.parent,
            review_time_ms:now,duration_ms:Math.max(0,now-started),rating,was_new:value.state.state===State.New,
            was_review:value.state.state===State.Review,scheduler_config_id:schedulerConfigId,state:next};
          validateEvent(event,manifest.import_id);
          const logPath=await appendReview(store,`${dataRoot}/reviews`,event);
          reviewFileMap().set(logPath,api.vault.getAbstractFileByPath(logPath));
          dirty.add(logPath);await syncIndex();return null;
        });
        await draw();if(result)notice.textContent=result;
      }catch(e){clearCard();message(e);notice.textContent+=" — review paused. Refresh to retry.";}
      finally{busy=false;if(pending){pending=false;scheduleRefresh();}}
    }
    async function guardedDraw(){if(checking){operation++;checking=false;}if(busy || managerDirty){pending=true;return;}busy=true;try{await draw();}catch(e){clearCard();message(e);}finally{busy=false;if(pending){pending=false;scheduleRefresh();}}}
    function scheduleRefresh(file,oldPath){
      if(disposed)return;
      if(file){
        const paths=[file.path,oldPath].filter(Boolean);
        let relevant=false;
        for(const path of paths){
          if(path.startsWith(`${dataRoot}/reviews/`)){
            if(reviewFiles){const f=api.vault.getAbstractFileByPath(path);if(f)reviewFiles.set(path,f);else reviewFiles.delete(path);}
            dirty.add(path);indexDirty=true;relevant=true;continue;
          }
          if(path===`${dataRoot}/manifest.json`||path===`${dataRoot}/catalog.pending.json`||path.startsWith(`${dataRoot}/cards/`)||path.startsWith(`${dataRoot}/notes/`)){catalogDirty=true;indexDirty=true;relevant=true;}
          if(path.startsWith(`${root}/config/`)||[`${root}/config.json`,`${root}/study.json`,`${dataRoot}/profiles.json`].includes(path)){runtimeDirty=true;contentCache.clear();metadataCache.clear();resolvedCards=null;relevant=true;}
          for(const card of cards){
            const dependent=card.source?.path===path||card.source?.candidates?.some(p=>path===p||path.startsWith(p+"/"))||card.source?.prepare==="prepare_taxonomy_notes"&&path.startsWith("wiki/life/");
            if(dependent){contentCache.delete(card.id);metadataCache.delete(card.id);dirty.add(path);relevant=true;resolvedCards=null;}
          }
        }
        if(!relevant)return;
        if(paths.some(path=>!path.startsWith(`${dataRoot}/reviews/`))){sourceGeneration++;operation++;checking=false;candidateSources.clear();taxonomy=null;resetQueues();}
      }else{indexDirty=true;}
      clearTimeout(refreshTimer);refreshTimer=setTimeout(guardedDraw,400);
    }
    home.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;panel="";managing=false;managerDirty=false;reviewing=false;selectedDeck=null;guardedDraw();};
    manage.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;panel="";managing=true;managerDirty=false;guardedDraw();};
    select.onchange=()=>{operation++;checking=false;if(!leaveEditor()){select.value=activeGroup;return;}activeGroup=select.value;panel="";managing=false;managerDirty=false;reviewing=Boolean(select.value);selectedDeck=null;guardedDraw();};
    refresh.onclick=()=>{if(managerDirty){notice.textContent="Save or discard changes before refreshing.";return;}reviewFiles=null;cache.clear();contentCache.clear();metadataCache.clear();candidateSources.clear();taxonomy=null;runtimeDirty=true;catalogDirty=true;indexDirty=true;sourceGeneration++;operation++;checking=false;resetQueues();guardedDraw();};
    rebuild.onclick=async()=>{if(busy)return;busy=true;try{await withStoreLock(identity,()=>index.clear());}catch(e){message(e);}finally{busy=false;await guardedDraw();}};
    profilesButton.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;managing=false;panel="profiles";guardedDraw();};
    sourcesButton.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;managing=false;panel="sources";guardedDraw();};
    function catalogDirectory(value,kind){
      if(value.catalog_layout!==undefined && value.catalog_layout!=="split" && value.catalog_layout!=="flat")throw Error("Unsupported catalog layout");
      if(value.catalog_layout==="flat")return kind;
      return `${value.catalog_layout==="split"?kind:"imports"}/${value.revision}`;
    }
    async function readPartitions(paths){return measure("Catalog partitions",()=>readCatalogPartitions(paths,json));}
    async function loadCatalog(value){

      const paths=value.partition_count===undefined?value.partitions:Array.from({length:value.partition_count},(_,i)=>`${catalogDirectory(value,"cards")}/cards-${String(i).padStart(5,"0")}.json`);
      const nextCards=await readPartitions(paths.map(path=>`${dataRoot}/${path}`));
      let nextNotes=[];
      if(value.note_partition_count!==undefined){
        if(!Number.isSafeInteger(value.note_partition_count)||value.note_partition_count<0)throw Error("Invalid note partition count");
        nextNotes=await readPartitions(Array.from({length:value.note_partition_count},(_,i)=>`${dataRoot}/${catalogDirectory(value,"notes")}/notes-${String(i).padStart(5,"0")}.json`));
      }
      const hydrated=value.note_partition_count===undefined?nextCards:hydrateCatalog(nextCards,nextNotes,(await cachedConfiguration()).study);
      baseManifest=value;rawCards=nextCards;noteBindings=nextNotes;cards=hydrated;knownCardIds=new Set(cards.map(c=>c.id));
    }
    try {
      manifest=await json(`${dataRoot}/manifest.json`);if(![1,2].includes(manifest.format_version))throw Error("Unsupported store format");
      if(manifest.partition_count!==undefined && (!Number.isSafeInteger(manifest.partition_count)||manifest.partition_count<0))throw Error("Invalid card partition count");
      await loadCatalog(manifest);
      index=await ReviewIndex.open(identity,manifest.import_id,manifest.timing);if(disposed){index.close();return;}
      select.createEl("option",{text:"All template groups",value:""});
      for(const group of [...new Set(cards.map(c=>c.group).filter(Boolean))].sort())select.createEl("option",{text:group,value:group});
      if(activeGroup)select.value=activeGroup;
      for(const name of ["create","modify","delete","rename"])component.registerEvent(api.vault.on(name,scheduleRefresh));
      component.registerEvent(api.metadataCache.on("changed",scheduleRefresh));
      component.registerInterval(setInterval(()=>{indexDirty=true;if(!shown)guardedDraw();},60000));
      component.registerInterval(setInterval(()=>{if(manifest&&(Date.now()>=nextWake||timeKey!==String(dayNumber(Date.now(),manifest.timing)))){nextWake=Infinity;if(!shown)guardedDraw();}},1000));await guardedDraw();
    }catch(e){message(e);}
  })();

})();
