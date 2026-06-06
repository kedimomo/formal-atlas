package main

import "fmt"

func HandleRequest(id string) string {
	u := authenticate(id)
	return queryDB(u)
}

func authenticate(id string) string {
	for i := 0; i < 3; i++ {
		fmt.Println(id)
	}
	return id
}

func queryDB(u string) string {
	return u
}

func unusedHelper() int { // lowercase + uncalled -> dead-code
	return 42
}
