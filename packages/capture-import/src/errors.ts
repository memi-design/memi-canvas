export class ImportTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportTransitionError";
  }
}
