/** A complex number: a filter's response at a frequency, multiplied and divided along a chain. */
export class Complex {
  constructor(readonly re: number, readonly im: number) {}

  mul(b: Complex): Complex {
    return new Complex(this.re * b.re - this.im * b.im, this.re * b.im + this.im * b.re);
  }

  div(b: Complex): Complex {
    const d = b.re * b.re + b.im * b.im;
    return new Complex((this.re * b.re + this.im * b.im) / d, (this.im * b.re - this.re * b.im) / d);
  }

  get abs(): number {
    return Math.hypot(this.re, this.im);
  }
}
