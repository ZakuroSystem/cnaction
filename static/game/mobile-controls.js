export class MobileControls {
  constructor(game) {
    this.game = game;
    this.container = document.getElementById('mobile-controls');
    this.handlers = [];
    this.boundUpdateVisibility = this.updateVisibility.bind(this);
    this.mediaQuery = window.matchMedia
      ? window.matchMedia('(max-width: 900px)')
      : null;
    this.directionMap = {
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
    };
    this.activeDirection = null;
    this.movementPointerId = null;
    this.enabled = false;
    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);

    if (!this.container) {
      return;
    }

    window.addEventListener('resize', this.boundUpdateVisibility);
    window.addEventListener('orientationchange', this.boundUpdateVisibility);
    if (this.mediaQuery) {
      if (this.mediaQuery.addEventListener) {
        this.mediaQuery.addEventListener('change', this.boundUpdateVisibility);
      } else if (this.mediaQuery.addListener) {
        this.mediaQuery.addListener(this.boundUpdateVisibility);
      }
    }

    this.bindActionButton();
    this.bindTouchMovement();
    this.updateVisibility();
  }

  bindActionButton() {
    const interact = this.container?.querySelector('[data-action="interact"]');
    if (!interact) {
      return;
    }

    const onDown = (event) => {
      event.preventDefault();
      interact.classList.add('is-active');
      this.game.emitInteract();
    };
    const onUp = (event) => {
      event.preventDefault();
      interact.classList.remove('is-active');
    };

    this.addListener(interact, 'pointerdown', onDown, { passive: false });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointerout'].forEach((type) => {
      this.addListener(interact, type, onUp, { passive: false });
    });
  }

  bindTouchMovement() {
    const options = { passive: false };
    this.addListener(document, 'pointerdown', this.boundPointerDown, options);
    this.addListener(document, 'pointermove', this.boundPointerMove, options);
    ['pointerup', 'pointercancel'].forEach((type) => {
      this.addListener(document, type, this.boundPointerUp, options);
    });
  }

  handlePointerDown(event) {
    if (!this.enabled) {
      return;
    }
    if (event.pointerType === 'mouse') {
      return;
    }
    const interact = this.container?.querySelector('[data-action="interact"]');
    if (interact && interact.contains(event.target)) {
      return;
    }
    if (this.movementPointerId && this.movementPointerId !== event.pointerId) {
      return;
    }
    this.movementPointerId = event.pointerId;
    event.preventDefault();
    this.updateDirectionFromPoint(event);
  }

  handlePointerMove(event) {
    if (!this.enabled || this.movementPointerId !== event.pointerId) {
      return;
    }
    if (event.pointerType === 'mouse') {
      return;
    }
    event.preventDefault();
    this.updateDirectionFromPoint(event);
  }

  handlePointerUp(event) {
    if (!this.enabled || this.movementPointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    this.movementPointerId = null;
    this.clearDirection();
  }

  updateDirectionFromPoint(event) {
    const direction = this.resolveDirection(event);
    if (!direction) {
      this.clearDirection();
      return;
    }
    this.engageDirection(direction);
  }

  resolveDirection(event) {
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!width || !height) {
      return null;
    }

    const x = event.clientX;
    const y = event.clientY;
    const bottomThreshold = height * 0.3;
    const topThreshold = height * 0.3;
    const horizontalMargin = width * 0.35;

    if (y >= height - bottomThreshold) {
      return 'down';
    }
    if (y <= topThreshold) {
      return 'up';
    }
    if (x >= width - horizontalMargin) {
      return 'right';
    }
    if (x <= horizontalMargin) {
      return 'left';
    }
    return null;
  }

  engageDirection(action) {
    if (!action || !this.directionMap[action]) {
      return;
    }
    if (this.activeDirection === action) {
      return;
    }

    if (this.activeDirection) {
      this.directionMap[this.activeDirection].forEach((code) =>
        this.game.setKeyState(code, false)
      );
    }

    this.activeDirection = action;
    this.directionMap[action].forEach((code) => this.game.setKeyState(code, true));
  }

  clearDirection() {
    if (!this.activeDirection) {
      return;
    }
    this.directionMap[this.activeDirection].forEach((code) =>
      this.game.setKeyState(code, false)
    );
    this.activeDirection = null;
  }

  addListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.handlers.push({ target, type, handler, options });
  }

  updateVisibility() {
    if (!this.container) return;
    const coarsePointer = window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    const narrowScreen = window.innerWidth <= 900;
    const shouldShow = coarsePointer || narrowScreen;

    if (shouldShow) {
      this.container.classList.add('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'false');
      this.enabled = true;
    } else {
      this.container.classList.remove('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'true');
      this.enabled = false;
      this.movementPointerId = null;
      this.clearDirection();
    }
  }

  destroy() {
    this.handlers.forEach(({ target, type, handler, options }) => {
      target.removeEventListener(type, handler, options);
    });
    this.handlers = [];
    this.clearDirection();
    this.movementPointerId = null;
    this.enabled = false;

    window.removeEventListener('resize', this.boundUpdateVisibility);
    window.removeEventListener('orientationchange', this.boundUpdateVisibility);
    if (this.mediaQuery) {
      if (this.mediaQuery.removeEventListener) {
        this.mediaQuery.removeEventListener('change', this.boundUpdateVisibility);
      } else if (this.mediaQuery.removeListener) {
        this.mediaQuery.removeListener(this.boundUpdateVisibility);
      }
    }

    if (this.container) {
      this.container.classList.remove('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'true');
    }
  }
}
