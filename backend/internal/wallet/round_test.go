package wallet

import "testing"

func TestBillableRoundingConcept(t *testing.T) {
	cases := []struct {
		elapsed int
		want    int
	}{
		{1, 60},
		{60, 60},
		{61, 120},
		{480, 480},
	}
	for _, c := range cases {
		got := ((c.elapsed + 59) / 60) * 60
		if got != c.want {
			t.Fatalf("elapsed %d: got %d want %d", c.elapsed, got, c.want)
		}
	}
}
