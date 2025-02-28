export class StatusManager {
  constructor(containerElement) {
    this.container = containerElement;
    this.isError = 'error';
    this.isSuccess= 'success';
  }

  show(message, type = 'success', timeoutMs = 2000) {
    if(type === this.isSuccess)
      this.container.classList.add('success-status');
    else
      this.container.classList.add('error-status');

    this.container.textContent = message;
    this.container.classList.add('visible');
    this.remove(timeoutMs);
  }

  remove(timeoutMs) {
    setTimeout(() => {
      this.clearStatus();
    }, timeoutMs);
  }

  clearStatus() {
    this.container.classList.remove('visible');
    this.container.classList.remove('success-status');
    this.container.classList.remove('error-status');
  }
}