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
    this.dpadPointerId = null;
    this.dpadBounds = null;

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

    this.bindButtons();
    this.updateVisibility();
  }

  bindButtons() {
    Object.keys(this.directionMap).forEach((action) => this.bindMovement(action));
    this.bindDpadGestures();

    const interact = this.container?.querySelector('[data-action="interact"]');
    if (interact) {
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
  }

  bindMovement(action) {
    const button = this.container?.querySelector(`[data-action="${action}"]`);
    if (!button) return;

    const onDown = (event) => {
      event.preventDefault();
      this.engageDirection(action);
    };
    const onUp = (event) => {
      event.preventDefault();
      if (this.activeDirection === action) {
        this.clearDirection();
      }
    };

    this.addListener(button, 'pointerdown', onDown, { passive: false });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointerout'].forEach((type) => {
      this.addListener(button, type, onUp, { passive: false });
    });
  }

  bindDpadGestures() {
    const dpad = this.container?.querySelector('.mobile-controls__cluster--dpad');
    if (!dpad) return;

    const onPointerDown = (event) => {
      event.preventDefault();
      this.dpadPointerId = event.pointerId;
      this.dpadBounds = dpad.getBoundingClientRect();
      if (dpad.setPointerCapture && event.pointerId !== undefined) {
        try {
          dpad.setPointerCapture(event.pointerId);
        } catch (error) {
          console.warn('[MobileControls] failed to capture pointer', error);
        }
      }
      this.updateDirectionFromPoint(event);
    };

    const onPointerMove = (event) => {
      if (this.dpadPointerId !== event.pointerId) return;
      event.preventDefault();
      this.updateDirectionFromPoint(event);
    };

    const onPointerUp = (event) => {
      if (this.dpadPointerId !== event.pointerId) return;
      event.preventDefault();
      if (dpad.releasePointerCapture && event.pointerId !== undefined) {
        try {
          dpad.releasePointerCapture(event.pointerId);
        } catch (error) {
          console.warn('[MobileControls] failed to release pointer', error);
        }
      }
      this.dpadPointerId = null;
      this.clearDirection();
    };

    this.addListener(dpad, 'pointerdown', onPointerDown, { passive: false });
    this.addListener(dpad, 'pointermove', onPointerMove, { passive: false });
    ['pointerup', 'pointercancel', 'pointerleave', 'pointerout'].forEach((type) => {
      this.addListener(dpad, type, onPointerUp, { passive: false });
    });
  }

  updateDirectionFromPoint(event) {
    if (!this.dpadBounds) return;
    const { left, top, width, height } = this.dpadBounds;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const x = event.clientX - centerX;
    const y = event.clientY - centerY;
    const deadZone = Math.min(width, height) * 0.18;

    if (Math.abs(x) < deadZone && Math.abs(y) < deadZone) {
      this.clearDirection();
      return;
    }

    let direction;
    if (Math.abs(x) > Math.abs(y)) {
      direction = x > 0 ? 'right' : 'left';
    } else {
      direction = y > 0 ? 'down' : 'up';
    }

    this.engageDirection(direction);
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
      this.toggleButtonState(this.activeDirection, false);
    }

    this.activeDirection = action;
    this.directionMap[action].forEach((code) => this.game.setKeyState(code, true));
    this.toggleButtonState(action, true);
  }

  clearDirection() {
    if (!this.activeDirection) {
      return;
    }
    this.directionMap[this.activeDirection].forEach((code) =>
      this.game.setKeyState(code, false)
    );
    this.toggleButtonState(this.activeDirection, false);
    this.activeDirection = null;
  }

  toggleButtonState(action, isActive) {
    const button = this.container?.querySelector(`[data-action="${action}"]`);
    if (!button) return;
    button.classList.toggle('is-active', Boolean(isActive));
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
    } else {
      this.container.classList.remove('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'true');
    }
  }

  destroy() {
    this.handlers.forEach(({ target, type, handler, options }) => {
      target.removeEventListener(type, handler, options);
    });
    this.handlers = [];
    this.clearDirection();
    this.dpadPointerId = null;
    this.dpadBounds = null;

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
